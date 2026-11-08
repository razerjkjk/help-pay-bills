CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_idx ON users(email);
--> statement-breakpoint
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
--> statement-breakpoint
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
--> statement-breakpoint
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX reports_bill_reporter_idx ON reports(bill_id, reporter_id);
--> statement-breakpoint
CREATE INDEX reports_status_idx ON reports(status);
--> statement-breakpoint
ALTER TABLE bills ADD COLUMN owner_id INTEGER REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE bills ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE pledges ADD COLUMN user_id INTEGER REFERENCES users(id);
