/**
 * The one shared DB connection for every server-side store in this app
 * (games/standing-games, matches/Glass). Previously games-db.ts and
 * matches-db.ts each memoized their own `createClient()` call, which meant
 * two separate better-sqlite3 connections open against the same SQLite
 * file from the same process — harmless under WAL (SQLite's own locking
 * still serializes writers), but it undercut games-service.ts's stated
 * safety argument for RSVP auto-promotion, which explicitly reasons about
 * "the single shared connection from games-db.ts" to rule out
 * interleaved transactions. One connection removes that gap and matches
 * what the comment already assumed.
 *
 * `createClient(dbPath)` itself (in @cuatro/db) still takes an optional
 * path and remains the right thing for tests that want an isolated
 * `:memory:` database — this singleton is only for the app's own
 * lazily-created, process-wide connection at `DATABASE_PATH`.
 */
import { createClient } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";

/*
 * The singleton MUST live on globalThis, not at module level: Next's dev
 * server compiles each route into its own server-bundle module instance, so a
 * module-level memo yields one postgres-js pool (max 6 connections) PER
 * VISITED ROUTE — a full crawl of ~12 routes exhausts local Postgres's 100
 * slots ("remaining connection slots are reserved for SUPERUSER"). globalThis
 * is shared across all of those module copies, so the whole process holds
 * exactly one pool in dev and prod alike.
 */
const g = globalThis as typeof globalThis & {
  __cuatroDbPromise?: Promise<CuatroClient> | null;
};

export function getDb(): Promise<CuatroClient> {
  if (!g.__cuatroDbPromise) g.__cuatroDbPromise = createClient();
  return g.__cuatroDbPromise;
}

/** Test-only: force a fresh connection on next getDb() call. */
export function __resetDbForTests() {
  g.__cuatroDbPromise = null;
}
