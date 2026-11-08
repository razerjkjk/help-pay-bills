// SQLite connection + migration runner (standalone edition).
//
// The app uses Drizzle ORM over bun:sqlite. Migrations live in `drizzle/`
// as plain SQL files ordered by `drizzle/meta/_journal.json` (the same files
// the Muse export shipped). On startup the server applies any migration
// that has not been applied yet and records it in `__migrations`, so
// restarts are safe and the database file can be created from empty.

import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function createDb(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

interface JournalEntry {
  idx: number;
  tag: string;
}

/**
 * Applies pending migrations from `migrationsDir` in journal order.
 * Each migration file is `<tag>.sql`; statements are split on Drizzle's
 * `-->` statement-breakpoint` marker. Safe to run on every startup.
 */
export function runMigrations(db: Db, migrationsDir: string): void {
  const client: Database = db.$client;
  client.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );

  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of entries) {
    const done = client
      .query("SELECT 1 AS one FROM __migrations WHERE name = ?")
      .get(entry.tag) as { one: number } | null;
    if (done) continue;

    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(file)) {
      throw new Error(`Migration file not found: ${file}`);
    }
    const sql = readFileSync(file, "utf8");
    for (const raw of sql.split("--> statement-breakpoint")) {
      const statement = raw.trim();
      if (statement) client.exec(statement);
    }
    client
      .query("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)")
      .run(entry.tag, Date.now());
    console.log(`[migrate] applied ${entry.tag}`);
  }
}
