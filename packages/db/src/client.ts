import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
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

// Arbitrary but fixed key for the boot-migration advisory lock. Every process
// that boots against the same Postgres takes this lock before running
// migrate(), so concurrent boots (Fly rolling deploy, multiple workers) can't
// race the schema. Database-global, so it serializes regardless of which
// pooled connection migrate() happens to use.
const MIGRATION_LOCK_KEY = 4927_0710

export type CuatroSchema = typeof schema

// The app-facing drizzle type. Deliberately the pg-core BASE type rather than
// `PostgresJsDatabase<CuatroSchema>` so BOTH the production (postgres-js) and
// the test (PGlite) drizzle instances are assignable to it with no cast — the
// query-builder / relational-query / transaction surface is identical across
// the two drivers, only the underlying result HKT differs (and that is in
// output position, so specific→base assignability holds).
export type CuatroDb = PgDatabase<
  PgQueryResultHKT,
  CuatroSchema,
  ExtractTablesWithRelations<CuatroSchema>
>

export type CuatroClient = {
  db: CuatroDb
  // Closes the underlying driver. ASYNC now (was sync on better-sqlite3):
  // postgres-js drains its pool, PGlite shuts down the in-process engine.
  close: () => Promise<void>
}

// Connects to Postgres at `databaseUrl` (default DATABASE_URL, falling back to
// the local Supabase stack), applies any pending migrations under an advisory
// lock, and returns a ready-to-query drizzle instance. ASYNC now — migrations
// run at boot and postgres-js migrate() is async.
export async function createClient(databaseUrl?: string): Promise<CuatroClient> {
  const url =
    databaseUrl ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

  const sql = postgres(url)
  const db = drizzle(sql, { schema })

  // Serialize concurrent boots. Take the advisory lock on a single reserved
  // session (lock/unlock MUST share a connection), then run migrate() — the
  // lock is database-global, so it still fences every other booter even
  // though migrate() runs on the pool.
  const lockConn = await sql.reserve()
  try {
    await lockConn`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`
    await migrate(db, { migrationsFolder })
  } finally {
    await lockConn`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    lockConn.release()
  }

  return {
    db,
    close: async () => {
      await sql.end({ timeout: 5 })
    },
  }
}

// Test-only client: a fresh in-memory PGlite (in-process Postgres) with all
// migrations applied. Returns the SAME CuatroClient shape as createClient, so
// test code is driver-agnostic. Replaces every `createClient(':memory:')`.
//
//   const client = await createTestClient()
//   await client.db.insert(users).values({ ... })
//   ...
//   await client.close()
//
// Each call is a brand-new isolated database (nothing shared between calls),
// matching the old better-sqlite3 `:memory:` isolation.
export async function createTestClient(): Promise<CuatroClient> {
  // Imported lazily so production bundles that only ever call createClient()
  // don't pull PGlite (and its wasm) into the graph.
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')
  const { migrate: migratePglite } = await import('drizzle-orm/pglite/migrator')

  const pg = new PGlite()
  const db = drizzlePglite(pg, { schema })
  await migratePglite(db, { migrationsFolder })

  return {
    db,
    close: async () => {
      await pg.close()
    },
  }
}
