// Help Pay Bills — action handlers, standalone edition.
//
// These handlers used to run inside the Muse/Hatch hosted runtime, where
// they received a `Ctx` from `@hatch/space-sdk` (defineAction, ctx.db,
// ctx.blobs, ctx.invalidateQueries). That SDK is gone: handlers now take a
// plain `ActionContext` (a Drizzle SQLite database + a local uploads
// directory + the signed-in user, if any) and are dispatched by
// `server/src/server.ts` over plain HTTP POSTs to `./actions` with
// `{action, args}`. All validation, dedupe keys, caps, and status math are
// unchanged from the original.
//
// Accounts (see `auth.ts`): posting a bill, recording a payment, editing,
// confirming, and reporting all need a signed-in account. A bill belongs
// to the account that posted it — only the poster (or an admin) can edit
// it, confirm payments on it, or delete it. Browsing the board stays open
// to everyone, signed in or not.

import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as schema from "./schema";
import type { Db } from "./db";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  hashPassword,
  isValidEmail,
  roleForNewUser,
  sessionCookie,
  verifyPassword,
  type SessionUser,
} from "./auth";
import { allow, reset as resetLimit } from "./ratelimit";

export type { Db };

/** Everything an action handler needs. Provided by server.ts per request. */
export interface ActionContext {
  /** Drizzle SQLite connection (already migrated on startup). */
  db: Db;
  /** Absolute directory where proof photos are stored on local disk. */
  uploadsDir: string;
  /** Public URL prefix under which proof photos are served, e.g. "/uploads". */
  uploadsBaseUrl: string;
  /** The signed-in user, resolved from the session cookie, or null. */
  user: SessionUser | null;
  /** Raw session token from the cookie (needed to sign out), or null. */
  sessionToken: string | null;
  /** Client IP, for rate limiting. */
  ip: string;
  /** Set-Cookie values to send back with the response. */
  cookies: string[];
}

const CATEGORIES = [
  "Electric",
  "Rent / Housing",
  "Water",
  "Gas / Heating",
  "Phone / Internet",
  "Medical",
  "Car / Insurance",
  "Groceries / Essentials",
  "Other",
] as const;

const REPORT_REASONS = [
  "Spam",
  "Scam / fake bill",
  "Wrong amount",
  "Abusive content",
  "Other",
] as const;

/** Rate limits (per window): bill posting 5/hour per account, 10/hour per
 *  IP; sign-in 10 attempts/15 min per IP plus 5 failed attempts/15 min per
 *  email; sign-up 10/hour per IP; reports 10/hour per account. */
const BILL_POSTS_PER_USER_PER_HOUR = 5;
const BILL_POSTS_PER_IP_PER_HOUR = 10;
const SIGNIN_PER_IP_PER_15_MIN = 10;
const SIGNIN_FAILURES_PER_EMAIL_PER_15_MIN = 5;
const SIGNUPS_PER_IP_PER_HOUR = 10;
const REPORTS_PER_USER_PER_HOUR = 10;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const pledgeSchema = z.object({
  id: z.number(),
  amountCents: z.number(),
  donorName: z.string().nullable(),
  note: z.string(),
  confirmed: z.boolean(),
  createdAt: z.string(),
});

const billSchema = z.object({
  id: z.number(),
  ownerId: z.number().nullable(),
  displayName: z.string(),
  biller: z.string(),
  category: z.string(),
  amountCents: z.number(),
  dueDate: z.string(),
  story: z.string(),
  paymentUrl: z.string().nullable(),
  paymentReference: z.string().nullable(),
  proofUrl: z.string().nullable(),
  paidConfirmed: z.boolean(),
  hidden: z.boolean(),
  /** True when the signed-in user posted this bill. */
  mine: z.boolean(),
  /** True when the signed-in user may edit/confirm/delete this bill
   *  (the poster, or an admin). */
  canManage: z.boolean(),
  /** Reports against this bill (admins only; 0 for everyone else). */
  reportCount: z.number(),
  reportedCents: z.number(),
  confirmedCents: z.number(),
  remainingCents: z.number(),
  status: z.enum(["needs", "partial", "funded", "paid"]),
  helperCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pledges: z.array(pledgeSchema),
});

const resultSchema = z.object({
  ok: z.boolean(),
  id: z.number().optional(),
  error: z.string().optional(),
});

const authResultSchema = z.object({
  ok: z.boolean(),
  id: z.number().optional(),
  error: z.string().optional(),
  user: z
    .object({
      id: z.number(),
      email: z.string(),
      name: z.string(),
      role: z.string(),
    })
    .optional(),
});

function isValidDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
  );
}

function isValidPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type ProofImage = { bytes: Uint8Array; contentType: string; ext: string } | null;

function parseProofImage(dataUrl: string | null | undefined): ProofImage | "invalid" {
  if (!dataUrl) return null;
  const match = dataUrl
    .trim()
    .match(/^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return "invalid";
  const contentType = match[1] ?? "image/jpeg";
  const subtype = match[2] ?? "jpeg";
  const base64 = match[3] ?? "";
  // ~6 MB cap on the encoded payload.
  if (base64.length > 8_000_000) return "invalid";
  const binary = atob(base64.replace(/\r?\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.length > 6_000_000 || bytes.length === 0) return "invalid";
  return { bytes, contentType, ext: subtype === "jpeg" ? "jpg" : subtype };
}

function randomSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Proof keys are always generated by this server; reject anything else so a
 *  stored key can never escape the uploads directory. */
function safeProofPath(uploadsDir: string, key: string): string | null {
  if (!/^proof\/[A-Za-z0-9-]+\.(jpg|png|webp|gif)$/.test(key)) return null;
  const resolved = path.resolve(uploadsDir, key);
  const base = path.resolve(uploadsDir);
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

async function storeProof(
  ctx: ActionContext,
  proof: NonNullable<ProofImage>,
): Promise<string> {
  const key = `proof/${randomSuffix()}.${proof.ext}`;
  const file = safeProofPath(ctx.uploadsDir, key);
  if (!file) throw new Error("Could not store the proof photo.");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, proof.bytes);
  return key;
}

async function deleteProof(ctx: ActionContext, key: string | null): Promise<void> {
  if (!key) return;
  const file = safeProofPath(ctx.uploadsDir, key);
  if (!file) return;
  try {
    await unlink(file);
  } catch {
    // A missing file must not block deleting or replacing a bill.
  }
}

/** The signed-in user, or an error message when there is none. */
function requireAuth(ctx: ActionContext): SessionUser | string {
  return ctx.user ?? "Sign in to do that.";
}

function requireAdmin(ctx: ActionContext): SessionUser | string {
  const user = requireAuth(ctx);
  if (typeof user === "string") return user;
  if (user.role !== "admin") return "Only an admin can do that.";
  return user;
}

/** True when this user may edit, confirm payments on, or delete this bill:
 *  the poster, or an admin. Bills posted before accounts existed have no
 *  owner, so only an admin can manage those. */
function canManageBill(ctx: ActionContext, bill: { ownerId: number | null }): boolean {
  if (!ctx.user) return false;
  if (ctx.user.role === "admin") return true;
  return bill.ownerId !== null && bill.ownerId === ctx.user.id;
}

async function loadBills(ctx: ActionContext): Promise<z.infer<typeof billSchema>[]> {
  const db = ctx.db;
  const billRows = await db.select().from(schema.bills).orderBy(asc(schema.bills.dueDate));
  const pledgeRows = await db.select().from(schema.pledges).orderBy(asc(schema.pledges.id));
  const byBill = new Map<number, typeof pledgeRows>();
  for (const pledge of pledgeRows) {
    const list = byBill.get(pledge.billId) ?? [];
    list.push(pledge);
    byBill.set(pledge.billId, list);
  }
  // Report counts, only shown to admins.
  const reportCounts = new Map<number, number>();
  if (ctx.user?.role === "admin") {
    const reportRows = await db.select().from(schema.reports);
    for (const report of reportRows) {
      reportCounts.set(report.billId, (reportCounts.get(report.billId) ?? 0) + 1);
    }
  }
  const bills: z.infer<typeof billSchema>[] = [];
  for (const row of billRows) {
    // Hidden bills are invisible to everyone except admins.
    if (row.hidden && ctx.user?.role !== "admin") continue;
    const pledges = byBill.get(row.id) ?? [];
    const reportedCents = pledges.reduce((sum, p) => sum + p.amountCents, 0);
    const confirmedCents = pledges
      .filter((p) => p.confirmed)
      .reduce((sum, p) => sum + p.amountCents, 0);
    const status: z.infer<typeof billSchema>["status"] = row.paidConfirmed
      ? "paid"
      : reportedCents >= row.amountCents
        ? "funded"
        : reportedCents > 0
          ? "partial"
          : "needs";
    const proofUrl = row.proofBlobKey
      ? `${ctx.uploadsBaseUrl}/${row.proofBlobKey}`
      : null;
    bills.push({
      id: row.id,
      ownerId: row.ownerId,
      displayName: row.displayName,
      biller: row.biller,
      category: row.category,
      amountCents: row.amountCents,
      dueDate: row.dueDate,
      story: row.story,
      paymentUrl: row.paymentUrl,
      paymentReference: row.paymentReference,
      proofUrl,
      paidConfirmed: row.paidConfirmed,
      hidden: row.hidden,
      mine: ctx.user !== null && row.ownerId !== null && row.ownerId === ctx.user.id,
      canManage: canManageBill(ctx, row),
      reportCount: reportCounts.get(row.id) ?? 0,
      reportedCents,
      confirmedCents,
      remainingCents: Math.max(0, row.amountCents - reportedCents),
      status,
      helperCount: pledges.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      pledges: pledges.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        donorName: p.donorName,
        note: p.note,
        confirmed: p.confirmed,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  }
  const rank = (b: z.infer<typeof billSchema>): number =>
    b.status === "paid" ? 3 : b.status === "funded" ? 2 : 0;
  bills.sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return b.id - a.id;
  });
  return bills;
}

const billFields = {
  displayName: z.string().trim().min(1).max(40),
  biller: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  amountCents: z.number().int().min(100).max(5_000_000),
  dueDate: z.string(),
  story: z.string().trim().max(600),
  paymentUrl: z.string().trim().max(500).nullable().optional(),
  paymentReference: z.string().trim().max(120).nullable().optional(),
  proofImageDataUrl: z.string().max(8_500_000).nullable().optional(),
};

function validateBillFields(args: {
  dueDate: string;
  paymentUrl?: string | null;
}): string | null {
  if (!isValidDueDate(args.dueDate)) return "Enter a real due date.";
  if (args.paymentUrl && !isValidPaymentUrl(args.paymentUrl)) {
    return "The payment link must start with http:// or https://.";
  }
  return null;
}

/**
 * Local replacement for the SDK's `defineAction`. It only carries the
 * request/response schemas and the handler — the HTTP dispatch lives in
 * `server.ts`, and the client refetches with TanStack Query instead of the
 * SDK's `ctx.invalidateQueries()`.
 */
function defineAction<R extends z.ZodType, S extends z.ZodType>(def: {
  description: string;
  request: R;
  response: S;
  handler: (ctx: ActionContext, args: z.infer<R>) => Promise<z.infer<S>>;
}) {
  return def;
}

async function findBill(
  ctx: ActionContext,
  id: number,
): Promise<typeof schema.bills.$inferSelect | null> {
  const rows = await ctx.db
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export const Actions = {
  // ---- Accounts -------------------------------------------------------

  getMe: defineAction({
    description: "Returns the signed-in account, or null when signed out.",
    request: z.object({}),
    response: z.object({
      user: z
        .object({
          id: z.number(),
          email: z.string(),
          name: z.string(),
          role: z.string(),
        })
        .nullable(),
    }),
    async handler(ctx) {
      return {
        user: ctx.user
          ? {
              id: ctx.user.id,
              email: ctx.user.email,
              name: ctx.user.name,
              role: ctx.user.role,
            }
          : null,
      };
    },
  }),

  signUp: defineAction({
    description: "Creates an account with an email and password and signs in.",
    request: z.object({
      email: z.string().trim().max(120),
      name: z.string().trim().min(1).max(40),
      password: z.string().min(8).max(128),
    }),
    response: authResultSchema,
    async handler(ctx, args): Promise<z.infer<typeof authResultSchema>> {
      if (!allow(`signup:ip:${ctx.ip}`, SIGNUPS_PER_IP_PER_HOUR, HOUR)) {
        return { ok: false, error: "Too many accounts created from here. Try again later." };
      }
      const email = args.email.toLowerCase();
      if (!isValidEmail(email)) {
        return { ok: false, error: "Enter a valid email address." };
      }
      const existing = await ctx.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing.length > 0) {
        return { ok: false, error: "An account with that email already exists. Sign in instead." };
      }
      const passwordHash = await hashPassword(args.password);
      const role = await roleForNewUser(ctx.db, email);
      const inserted = await ctx.db
        .insert(schema.users)
        .values({ email, name: args.name.trim(), passwordHash, role })
        .returning({ id: schema.users.id });
      const row = inserted[0];
      if (!row) return { ok: false, error: "The account could not be created. Try again." };
      const token = await createSession(ctx.db, row.id);
      ctx.cookies.push(sessionCookie(token));
      return {
        ok: true,
        id: row.id,
        user: { id: row.id, email, name: args.name.trim(), role },
      };
    },
  }),

  signIn: defineAction({
    description: "Signs in with an email and password.",
    request: z.object({
      email: z.string().trim().max(120),
      password: z.string().min(1).max(128),
    }),
    response: authResultSchema,
    async handler(ctx, args): Promise<z.infer<typeof authResultSchema>> {
      const email = args.email.toLowerCase();
      if (!allow(`signin:ip:${ctx.ip}`, SIGNIN_PER_IP_PER_15_MIN, 15 * MINUTE)) {
        return { ok: false, error: "Too many sign-in attempts from here. Try again in a little while." };
      }
      if (!allow(`signin:email:${email}`, SIGNIN_FAILURES_PER_EMAIL_PER_15_MIN, 15 * MINUTE)) {
        return { ok: false, error: "Too many sign-in attempts for this email. Try again in a little while." };
      }
      const wrong = { ok: false, error: "That email or password is not correct." } as const;
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user) return wrong;
      if (user.blocked) {
        return { ok: false, error: "This account is blocked. Contact the site admin." };
      }
      if (!(await verifyPassword(args.password, user.passwordHash))) return wrong;
      resetLimit(`signin:email:${email}`);
      const token = await createSession(ctx.db, user.id);
      ctx.cookies.push(sessionCookie(token));
      return {
        ok: true,
        id: user.id,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      };
    },
  }),

  signOut: defineAction({
    description: "Signs out, ending the current session.",
    request: z.object({}),
    response: resultSchema,
    async handler(ctx): Promise<z.infer<typeof resultSchema>> {
      if (ctx.sessionToken) {
        await deleteSession(ctx.db, ctx.sessionToken);
      }
      ctx.cookies.push(clearSessionCookie());
      return { ok: true };
    },
  }),

  // ---- Bills ----------------------------------------------------------

  listBills: defineAction({
    description: "Lists posted bills with donor-reported progress, most urgent first. Hidden bills only show to admins.",
    request: z.object({}),
    response: z.object({ bills: z.array(billSchema) }),
    async handler(ctx) {
      return { bills: await loadBills(ctx) };
    },
  }),

  createBill: defineAction({
    description: "Posts a bill someone needs help paying, with an optional proof photo. Requires sign-in; the bill belongs to your account.",
    request: z.object({ ...billFields, formKey: z.string().min(1).max(80) }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const user = requireAuth(ctx);
      if (typeof user === "string") return { ok: false, error: user };
      const db = ctx.db;
      if (args.formKey) {
        const existing = await db
          .select({ id: schema.bills.id })
          .from(schema.bills)
          .where(eq(schema.bills.formKey, args.formKey))
          .limit(1);
        const found = existing[0];
        if (found) return { ok: true, id: found.id };
      }
      const fieldError = validateBillFields(args);
      if (fieldError) return { ok: false, error: fieldError };
      // Rate-limit only bills that would actually be created: retries of
      // the same form and invalid forms do not burn the quota.
      if (
        !allow(`billpost:user:${user.id}`, BILL_POSTS_PER_USER_PER_HOUR, HOUR) ||
        !allow(`billpost:ip:${ctx.ip}`, BILL_POSTS_PER_IP_PER_HOUR, HOUR)
      ) {
        return { ok: false, error: "You're posting bills too fast. Try again in a little while." };
      }
      const proof = parseProofImage(args.proofImageDataUrl);
      if (proof === "invalid") {
        return { ok: false, error: "That photo could not be used. Try a JPG or PNG under 6 MB." };
      }
      const proofBlobKey = proof ? await storeProof(ctx, proof) : null;
      const inserted = await db
        .insert(schema.bills)
        .values({
          ownerId: user.id,
          displayName: args.displayName,
          biller: args.biller,
          category: args.category,
          amountCents: args.amountCents,
          dueDate: args.dueDate,
          story: args.story,
          paymentUrl: args.paymentUrl || null,
          paymentReference: args.paymentReference || null,
          proofBlobKey,
          proofContentType: proof ? proof.contentType : null,
          formKey: args.formKey,
        })
        .returning({ id: schema.bills.id });
      const row = inserted[0];
      if (!row) return { ok: false, error: "The bill could not be saved. Try again." };
      return { ok: true, id: row.id };
    },
  }),

  updateBill: defineAction({
    description: "Edits a posted bill, optionally replacing or removing its proof photo. Only the poster or an admin.",
    request: z.object({
      id: z.number().int().positive(),
      ...billFields,
      removeProof: z.boolean().default(false),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const db = ctx.db;
      const row = await findBill(ctx, args.id);
      if (!row) return { ok: false, error: "That bill is no longer here." };
      if (!canManageBill(ctx, row)) {
        return { ok: false, error: "You can only edit bills you posted." };
      }
      const fieldError = validateBillFields(args);
      if (fieldError) return { ok: false, error: fieldError };
      const proof = parseProofImage(args.proofImageDataUrl);
      if (proof === "invalid") {
        return { ok: false, error: "That photo could not be used. Try a JPG or PNG under 6 MB." };
      }
      let proofBlobKey = row.proofBlobKey;
      let proofContentType = row.proofContentType;
      if (proof) {
        const nextKey = await storeProof(ctx, proof);
        await deleteProof(ctx, row.proofBlobKey);
        proofBlobKey = nextKey;
        proofContentType = proof.contentType;
      } else if (args.removeProof) {
        await deleteProof(ctx, row.proofBlobKey);
        proofBlobKey = null;
        proofContentType = null;
      }
      await db
        .update(schema.bills)
        .set({
          displayName: args.displayName,
          biller: args.biller,
          category: args.category,
          amountCents: args.amountCents,
          dueDate: args.dueDate,
          story: args.story,
          paymentUrl: args.paymentUrl || null,
          paymentReference: args.paymentReference || null,
          proofBlobKey,
          proofContentType,
          updatedAt: new Date(),
        })
        .where(eq(schema.bills.id, args.id));
      return { ok: true, id: args.id };
    },
  }),

  deleteBill: defineAction({
    description: "Deletes a posted bill and its recorded payments. Only the poster or an admin.",
    request: z.object({ id: z.number().int().positive() }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const db = ctx.db;
      const row = await findBill(ctx, args.id);
      if (!row) return { ok: false, error: "That bill is no longer here." };
      if (!canManageBill(ctx, row)) {
        return { ok: false, error: "You can only delete bills you posted." };
      }
      await db.delete(schema.pledges).where(eq(schema.pledges.billId, args.id));
      await db.delete(schema.reports).where(eq(schema.reports.billId, args.id));
      await db.delete(schema.bills).where(eq(schema.bills.id, args.id));
      await deleteProof(ctx, row.proofBlobKey);
      return { ok: true, id: args.id };
    },
  }),

  recordPayment: defineAction({
    description: "Records a donor-reported payment made directly to the biller, capped at the amount still needed. Requires sign-in; the payment is tied to your account.",
    request: z.object({
      billId: z.number().int().positive(),
      amountCents: z.number().int().positive(),
      donorName: z.string().trim().max(40).optional(),
      note: z.string().trim().max(200).optional(),
      pledgeKey: z.string().min(1).max(80),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const user = requireAuth(ctx);
      if (typeof user === "string") return { ok: false, error: user };
      const db = ctx.db;
      const byKey = await db
        .select({ id: schema.pledges.id })
        .from(schema.pledges)
        .where(eq(schema.pledges.pledgeKey, args.pledgeKey))
        .limit(1);
      const dup = byKey[0];
      if (dup) return { ok: true, id: dup.id };
      const bills = await loadBills(ctx);
      const bill = bills.find((b) => b.id === args.billId);
      if (!bill) return { ok: false, error: "That bill is no longer here." };
      if (bill.paidConfirmed) {
        return { ok: false, error: "This bill is already confirmed paid." };
      }
      if (args.amountCents > bill.remainingCents) {
        return {
          ok: false,
          error: `Only ${formatCents(bill.remainingCents)} is still needed for this bill.`,
        };
      }
      const inserted = await db
        .insert(schema.pledges)
        .values({
          billId: args.billId,
          userId: user.id,
          amountCents: args.amountCents,
          donorName: args.donorName || null,
          note: args.note ?? "",
          pledgeKey: args.pledgeKey,
        })
        .returning({ id: schema.pledges.id });
      const row = inserted[0];
      if (!row) return { ok: false, error: "The payment could not be recorded. Try again." };
      return { ok: true, id: row.id };
    },
  }),

  setPledgeConfirmed: defineAction({
    description: "Marks one donor-reported payment as confirmed or unconfirmed by the poster. Only the poster or an admin.",
    request: z.object({
      pledgeId: z.number().int().positive(),
      confirmed: z.boolean(),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const db = ctx.db;
      const pledgeRows = await db
        .select()
        .from(schema.pledges)
        .where(eq(schema.pledges.id, args.pledgeId))
        .limit(1);
      const pledge = pledgeRows[0];
      if (!pledge) return { ok: false, error: "That payment is no longer here." };
      const bill = await findBill(ctx, pledge.billId);
      if (!bill) return { ok: false, error: "That bill is no longer here." };
      if (!canManageBill(ctx, bill)) {
        return { ok: false, error: "Only the person who posted this bill can confirm payments on it." };
      }
      await db
        .update(schema.pledges)
        .set({ confirmed: args.confirmed })
        .where(eq(schema.pledges.id, args.pledgeId));
      return { ok: true, id: args.pledgeId };
    },
  }),

  setBillPaid: defineAction({
    description: "Marks a bill as confirmed paid by the poster, or reopens it. Only the poster or an admin.",
    request: z.object({
      billId: z.number().int().positive(),
      paid: z.boolean(),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const db = ctx.db;
      const bill = await findBill(ctx, args.billId);
      if (!bill) return { ok: false, error: "That bill is no longer here." };
      if (!canManageBill(ctx, bill)) {
        return { ok: false, error: "Only the person who posted this bill can mark it paid." };
      }
      await db
        .update(schema.bills)
        .set({ paidConfirmed: args.paid, updatedAt: new Date() })
        .where(eq(schema.bills.id, args.billId));
      return { ok: true, id: args.billId };
    },
  }),

  // ---- Moderation -----------------------------------------------------

  reportBill: defineAction({
    description: "Reports a bill for review by an admin. Requires sign-in; one report per person per bill.",
    request: z.object({
      billId: z.number().int().positive(),
      reason: z.enum(REPORT_REASONS),
      note: z.string().trim().max(200).optional(),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const user = requireAuth(ctx);
      if (typeof user === "string") return { ok: false, error: user };
      if (!allow(`report:user:${user.id}`, REPORTS_PER_USER_PER_HOUR, HOUR)) {
        return { ok: false, error: "You're reporting too many bills. Try again later." };
      }
      const db = ctx.db;
      const bill = await findBill(ctx, args.billId);
      if (!bill || (bill.hidden && user.role !== "admin")) {
        return { ok: false, error: "That bill is no longer here." };
      }
      const existing = await db
        .select({ id: schema.reports.id })
        .from(schema.reports)
        .where(
          and(
            eq(schema.reports.billId, args.billId),
            eq(schema.reports.reporterId, user.id),
          ),
        )
        .limit(1);
      const dup = existing[0];
      if (dup) return { ok: true, id: dup.id };
      const inserted = await db
        .insert(schema.reports)
        .values({
          billId: args.billId,
          reporterId: user.id,
          reason: args.reason,
          note: args.note ?? "",
        })
        .returning({ id: schema.reports.id });
      const row = inserted[0];
      if (!row) return { ok: false, error: "The report could not be saved. Try again." };
      return { ok: true, id: row.id };
    },
  }),

  listReports: defineAction({
    description: "Lists all bill reports, newest first. Admins only.",
    request: z.object({}),
    response: z.object({
      reports: z.array(
        z.object({
          id: z.number(),
          billId: z.number(),
          billBiller: z.string(),
          billAmountCents: z.number(),
          billHidden: z.boolean(),
          reporterName: z.string(),
          reporterEmail: z.string(),
          reason: z.string(),
          note: z.string(),
          status: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { reports: [] };
      const db = ctx.db;
      const rows = await db
        .select()
        .from(schema.reports)
        .orderBy(desc(schema.reports.createdAt), desc(schema.reports.id));
      const out = [];
      for (const report of rows) {
        const bill = await findBill(ctx, report.billId);
        const reporterRows = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.id, report.reporterId))
          .limit(1);
        const reporter = reporterRows[0];
        out.push({
          id: report.id,
          billId: report.billId,
          billBiller: bill?.biller ?? "(deleted bill)",
          billAmountCents: bill?.amountCents ?? 0,
          billHidden: bill?.hidden ?? false,
          reporterName: reporter?.name ?? "(deleted account)",
          reporterEmail: reporter?.email ?? "",
          reason: report.reason,
          note: report.note,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
        });
      }
      return { reports: out };
    },
  }),

  resolveReport: defineAction({
    description: "Marks a report open or resolved. Admins only.",
    request: z.object({
      reportId: z.number().int().positive(),
      status: z.enum(["open", "resolved"]),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { ok: false, error: admin };
      await ctx.db
        .update(schema.reports)
        .set({ status: args.status })
        .where(eq(schema.reports.id, args.reportId));
      return { ok: true, id: args.reportId };
    },
  }),

  hideBill: defineAction({
    description: "Hides a bill from everyone except admins. Admins only.",
    request: z.object({ billId: z.number().int().positive() }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { ok: false, error: admin };
      const bill = await findBill(ctx, args.billId);
      if (!bill) return { ok: false, error: "That bill is no longer here." };
      await ctx.db
        .update(schema.bills)
        .set({ hidden: true, updatedAt: new Date() })
        .where(eq(schema.bills.id, args.billId));
      return { ok: true, id: args.billId };
    },
  }),

  unhideBill: defineAction({
    description: "Makes a hidden bill visible again. Admins only.",
    request: z.object({ billId: z.number().int().positive() }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { ok: false, error: admin };
      const bill = await findBill(ctx, args.billId);
      if (!bill) return { ok: false, error: "That bill is no longer here." };
      await ctx.db
        .update(schema.bills)
        .set({ hidden: false, updatedAt: new Date() })
        .where(eq(schema.bills.id, args.billId));
      return { ok: true, id: args.billId };
    },
  }),

  listUsers: defineAction({
    description: "Lists all accounts for moderation. Admins only.",
    request: z.object({}),
    response: z.object({
      users: z.array(
        z.object({
          id: z.number(),
          email: z.string(),
          name: z.string(),
          role: z.string(),
          blocked: z.boolean(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { users: [] };
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .orderBy(asc(schema.users.createdAt), asc(schema.users.id));
      return {
        users: rows.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          blocked: u.blocked,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  }),

  blockUser: defineAction({
    description: "Blocks or unblocks an account. A blocked account cannot sign in and its sessions stop working. Admins only; admins and your own account cannot be blocked.",
    request: z.object({
      userId: z.number().int().positive(),
      blocked: z.boolean(),
    }),
    response: resultSchema,
    async handler(ctx, args): Promise<z.infer<typeof resultSchema>> {
      const admin = requireAdmin(ctx);
      if (typeof admin === "string") return { ok: false, error: admin };
      if (args.userId === admin.id) {
        return { ok: false, error: "You cannot block your own account." };
      }
      const rows = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      const target = rows[0];
      if (!target) return { ok: false, error: "That account is no longer here." };
      if (target.role === "admin") {
        return { ok: false, error: "Admin accounts cannot be blocked." };
      }
      await ctx.db
        .update(schema.users)
        .set({ blocked: args.blocked })
        .where(eq(schema.users.id, args.userId));
      if (args.blocked) {
        await deleteSessionsForUser(ctx.db, args.userId);
      }
      return { ok: true, id: args.userId };
    },
  }),
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
