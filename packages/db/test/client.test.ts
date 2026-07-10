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

  it('records exactly one migration batch (migrate did not double-apply)', async () => {
    client = await createTestClient()

    const result = await client.db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    )
    const count = (result as unknown as { rows: { count: number }[] }).rows[0].count
    expect(count).toBe(1)
  })
})
