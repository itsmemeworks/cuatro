import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circleMessages, circles, users } from '../src/schema/index.js'

describe('circle_messages', () => {
  let client: CuatroClient

  beforeEach(() => {
    client = createClient(':memory:')
  })

  afterEach(() => {
    client.close()
  })

  it('persists a message and orders by insertion (rowid) even when created_at ties', async () => {
    const [author] = await client.db
      .insert(users)
      .values({ email: 'chat@example.com', displayName: 'Chat User' })
      .returning()
    const [circle] = await client.db
      .insert(circles)
      .values({ name: 'Chat Circle', inviteCode: 'CHATCIRCLE', createdBy: author.id })
      .returning()

    // All three share one Date instance to reproduce the ms-resolution tie
    // that the rowid ordering (see schema comment) is there to break.
    const sameInstant = new Date()
    await client.db.insert(circleMessages).values([
      { circleId: circle.id, userId: author.id, body: 'first', createdAt: sameInstant },
      { circleId: circle.id, userId: author.id, body: 'second', createdAt: sameInstant },
      { circleId: circle.id, userId: author.id, body: 'third', createdAt: sameInstant },
    ])

    const rows = client.sqlite
      .prepare('select body from circle_messages where circle_id = ? order by rowid asc')
      .all(circle.id) as { body: string }[]

    expect(rows.map((r) => r.body)).toEqual(['first', 'second', 'third'])
  })

  it('rejects a message referencing a nonexistent circle', async () => {
    const [author] = await client.db
      .insert(users)
      .values({ email: 'orphan@example.com', displayName: 'Orphan' })
      .returning()

    await expect(
      client.db.insert(circleMessages).values({
        circleId: 'nonexistent-circle-id',
        userId: author.id,
        body: 'hello',
      }),
    ).rejects.toThrow()
  })

  it('rejects a message with no body', async () => {
    const [author] = await client.db
      .insert(users)
      .values({ email: 'nobody@example.com', displayName: 'No Body' })
      .returning()
    const [circle] = await client.db
      .insert(circles)
      .values({ name: 'Circle', inviteCode: 'NOBODYCIRCLE', createdBy: author.id })
      .returning()

    await expect(
      client.db.insert(circleMessages).values({
        circleId: circle.id,
        userId: author.id,
      } as never),
    ).rejects.toThrow()
  })
})
