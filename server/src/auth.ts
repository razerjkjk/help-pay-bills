// Accounts and cookie sessions (standalone edition).
//
// Self-contained: no third-party login service. Passwords are hashed with
// argon2id via Bun's built-in `Bun.password` (no extra dependency).
// Sessions are random tokens: the raw token lives only in the user's
// HttpOnly cookie, and only its SHA-256 hash is stored in the database,
// so a stolen database backup does not hand out live sessions.
//
// Admin setup: set ADMIN_EMAIL to the admin's email address. Any account
// with that email becomes an admin — at signup, and again on every server
// start (so the admin can be promoted even if the account already
// exists). If no admin exists at all yet, the very first account to sign
// up becomes the admin. Documented in the README.

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import * as schema from "./schema";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export const SESSION_COOKIE = "hpb_session";
/** Sessions last 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Create a session for a user and return the raw token for the cookie. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

/** Resolve a raw session token to the signed-in user, or null. A blocked
 *  user's sessions stop working immediately. */
export async function userFromSession(
  db: Db,
  token: string | null | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  const session = rows[0];
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
    return null;
  }
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  const user = users[0];
  if (!user) return null;
  if (user.blocked) {
    // A blocked account loses all sessions at once.
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, user.id));
    return null;
  }
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)));
}

export async function deleteSessionsForUser(
  db: Db,
  userId: number,
): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
}

/** Which role a brand-new account gets. The ADMIN_EMAIL account is always
 *  an admin; otherwise the first account ever created becomes the admin so
 *  a fresh deployment always has one. */
export async function roleForNewUser(
  db: Db,
  email: string,
): Promise<"user" | "admin"> {
  if (ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL) return "admin";
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, "admin"))
    .limit(1);
  if (admins.length === 0) return "admin";
  return "user";
}

/** On server start: if ADMIN_EMAIL is set and that account exists but is
 *  not yet an admin, promote it. This lets the admin be set after the
 *  account was already created. */
export async function ensureAdmin(db: Db): Promise<void> {
  if (!ADMIN_EMAIL) return;
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);
  const user = rows[0];
  if (user && user.role !== "admin") {
    await db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.id, user.id));
    console.log(`[auth] promoted ${ADMIN_EMAIL} to admin`);
  }
}

function cookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "1";
}

/** Set-Cookie value for a fresh session. HttpOnly so page JavaScript can
 *  never read the token; SameSite=Lax so the cookie is sent on the app's
 *  own POSTs but not on cross-site requests. */
export function sessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie value that clears the session cookie. */
export function clearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (cookieSecure()) parts.push("Secure");
  return parts.join("; ");
}

/** Pull the session token out of a Cookie header. */
export function sessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
