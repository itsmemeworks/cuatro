import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema/index.js'

// Resolving the migrations folder is trickier than it looks once this
// package gets bundled (e.g. Next's transpilePackages + webpack): webpack
// statically replaces `import.meta.url` with the *build-time* source path
// of this file, which no longer exists once only production output is
// deployed. tsx/vitest don't do this rewrite, so the __dirname-based path
// keeps working for local dev/tests/scripts — it's only the bundled case
// that needs a fallback.
//
// The deploy image sets CUATRO_DB_MIGRATIONS_PATH explicitly (see root
// Dockerfile), which takes priority and is the only path guaranteed
// correct there: Next's standalone server.js does `process.chdir(__dirname)`
// before this module ever runs, so cwd-based guesses depend on exactly
// where in the tree the server happened to start from.
function resolveMigrationsFolder(): string {
  const override = process.env.CUATRO_DB_MIGRATIONS_PATH
  if (override) return override

  const fromModule = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
  if (fs.existsSync(fromModule)) return fromModule

  // Best-effort fallbacks for bundled runtimes that didn't set the
  // override: try cwd as the monorepo root, then cwd two levels down
  // (matches Next standalone's apps/<name> chdir).
  const candidates = [
    path.join(process.cwd(), 'packages', 'db', 'migrations'),
    path.join(process.cwd(), '..', '..', 'packages', 'db', 'migrations'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    `[@cuatro/db] could not locate migrations folder (tried "${fromModule}" and [${candidates.join(', ')}]). ` +
      'Set CUATRO_DB_MIGRATIONS_PATH to override.'
  )
}

const migrationsFolder = resolveMigrationsFolder()

export type CuatroSchema = typeof schema
export type CuatroDb = BetterSQLite3Database<CuatroSchema>

export type CuatroClient = {
  db: CuatroDb
  sqlite: Database.Database
  close: () => void
}

// Creates (or opens) the SQLite file at `dbPath`, applies any pending
// migrations, and returns a ready-to-query drizzle instance. `dbPath`
// defaults to DATABASE_PATH, falling back to ./dev.db for local dev.
export function createClient(dbPath?: string): CuatroClient {
  const resolvedPath = dbPath ?? process.env.DATABASE_PATH ?? './dev.db'
  const sqlite = new Database(resolvedPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  }
}
