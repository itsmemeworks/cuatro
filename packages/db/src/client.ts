import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.join(__dirname, '..', 'migrations')

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
