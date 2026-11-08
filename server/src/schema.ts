import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const bills = sqliteTable(
  "bills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Account that posted the bill. Null for bills posted before accounts existed. */
    ownerId: integer("owner_id").references(() => users.id),
    displayName: text("display_name").notNull(),
    biller: text("biller").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueDate: text("due_date").notNull(),
    story: text("story").notNull().default(""),
    paymentUrl: text("payment_url"),
    paymentReference: text("payment_reference"),
    proofBlobKey: text("proof_blob_key"),
    proofContentType: text("proof_content_type"),
    paidConfirmed: integer("paid_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Hidden by an admin after a report; only admins still see it. */
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    formKey: text("form_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("bills_due_date_idx").on(t.dueDate),
    uniqueIndex("bills_form_key_idx").on(t.formKey),
  ],
);

export const pledges = sqliteTable(
  "pledges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    billId: integer("bill_id")
      .notNull()
      .references(() => bills.id),
    /** Account that recorded the payment. Null for pre-account pledges. */
    userId: integer("user_id").references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    donorName: text("donor_name"),
    note: text("note").notNull().default(""),
    confirmed: integer("confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    pledgeKey: text("pledge_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("pledges_bill_id_idx").on(t.billId),
    uniqueIndex("pledges_pledge_key_idx").on(t.pledgeKey),
  ],
);

/** Accounts. Passwords are stored only as argon2id hashes (Bun.password). */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Lowercased on signup; unique. */
    email: text("email").notNull(),
    /** First name, shown on bills the user posts. */
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** "user" or "admin". Admins moderate bills and accounts. */
    role: text("role").notNull().default("user"),
    blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** Cookie sessions. Only a SHA-256 hash of the token is stored; the raw
 *  token lives only in the user's HttpOnly cookie. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

/** User reports on bills. One report per user per bill. */
export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    billId: integer("bill_id")
      .notNull()
      .references(() => bills.id),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    /** "open" or "resolved". */
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("reports_bill_reporter_idx").on(t.billId, t.reporterId),
    index("reports_status_idx").on(t.status),
  ],
);
