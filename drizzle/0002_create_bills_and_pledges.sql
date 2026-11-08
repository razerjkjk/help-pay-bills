CREATE TABLE bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  biller TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  story TEXT NOT NULL DEFAULT '',
  payment_url TEXT,
  payment_reference TEXT,
  proof_blob_key TEXT,
  proof_content_type TEXT,
  paid_confirmed INTEGER NOT NULL DEFAULT 0,
  form_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE pledges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  amount_cents INTEGER NOT NULL,
  donor_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 0,
  pledge_key TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX bills_due_date_idx ON bills(due_date);
--> statement-breakpoint
CREATE INDEX pledges_bill_id_idx ON pledges(bill_id);
--> statement-breakpoint
CREATE UNIQUE INDEX bills_form_key_idx ON bills(form_key);
--> statement-breakpoint
CREATE UNIQUE INDEX pledges_pledge_key_idx ON pledges(pledge_key);
--> statement-breakpoint
DROP TABLE entries;
