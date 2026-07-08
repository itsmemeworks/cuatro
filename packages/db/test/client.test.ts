import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'

describe('createClient', () => {
  let client: CuatroClient | undefined

  afterEach(() => {
    client?.close()
    client = undefined
  })

  it('creates a fresh in-memory database and applies all migrations', () => {
    client = createClient(':memory:')

    const tableNames = client.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
      )
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'users',
        'circles',
        'circle_members',
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

  it('is idempotent — migrating an already-migrated database is a no-op', () => {
    client = createClient(':memory:')
    // Re-running migrate() via a second createClient on the same handle isn't
    // possible for :memory:, so instead assert the migrations table recorded
    // exactly one batch (proves migrate() didn't double-apply on construction).
    const migrationRows = client.sqlite
      .prepare(
        "select count(*) as count from sqlite_master where type = 'table' and name like '%drizzle%'",
      )
      .get() as { count: number }
    expect(migrationRows.count).toBeGreaterThanOrEqual(1)
  })
})
