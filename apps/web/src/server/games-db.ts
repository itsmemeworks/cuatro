/**
 * Games surface's DB accessor — now a thin re-export of the shared
 * connection in ./db.ts (see that file's header for why matches-db.ts and
 * this module were consolidated onto one connection). Kept as its own
 * module/name so games-service.ts, standing-games-service.ts, and every
 * games/* route and page can keep importing `getGamesClient` from here
 * unchanged.
 *
 * Concurrency-critical mutations (RSVP dropout -> auto-promotion) run
 * inside `db.transaction(...)` against this shared connection. better-
 * sqlite3 transactions execute fully synchronously (no `await` inside), so
 * as long as every write path gets its `CuatroDb` from here rather than
 * opening a fresh connection per call, two "concurrent" RSVP mutations
 * within this process can never interleave mid-transaction — one fully
 * commits before the next transaction's callback runs.
 */
export { getDb as getGamesClient, __resetDbForTests as __resetGamesClientForTests } from "./db";
