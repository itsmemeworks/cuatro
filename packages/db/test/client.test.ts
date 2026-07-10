import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'

describe('createTestClient', () => {
  let client: CuatroClient | undefined

  afterEach(async () => {
    await client?.close()
    client = undefined
  })

  it('creates a fresh in-memory database and applies all migrations', async () => {
    client = await createTestClient()

    const result = await client.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
    const tableNames = (result as unknown as { rows: { table_name: string }[] }).rows.map(
      (row) => row.table_name,
    )

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'users',
        'circles',
        'circle_members',
        'circle_messages',
        'venues',
        'standing_games',
        'sessions',
        'rsvps',
        'matches',
        'match_confirmations',
        'rating_events',
        'tabs',
        'tab_entries',
        'notifications',
        'magic_link_tokens',
        'sessions_auth',
      ]),
    )
  })

  it('records one batch per migration file (migrate did not double-apply)', async () => {
    client = await createTestClient()

    // One journal row per .sql migration — pinned to the folder's actual
    // contents so adding migration N+1 doesn't break this test, while a
    // double-apply (2x the file count) still fails loudly.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const migrationFiles = fs
      .readdirSync(path.join(__dirname, '..', 'migrations'))
      .filter((f) => f.endsWith('.sql')).length

    const result = await client.db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    )
    const count = (result as unknown as { rows: { count: number }[] }).rows[0].count
    expect(count).toBe(migrationFiles)
  })
})
