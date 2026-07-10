import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circleMessages, circles, users } from '../src/schema/index.js'

describe('circle_messages', () => {
  let client: CuatroClient

  beforeEach(async () => {
    client = await createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  it('persists a message and orders by the seq identity even when created_at ties', async () => {
    const [author] = await client.db
      .insert(users)
      .values({ email: 'chat@example.com', displayName: 'Chat User' })
      .returning()
    const [circle] = await client.db
      .insert(circles)
      .values({ name: 'Chat Circle', inviteCode: 'CHATCIRCLE', createdBy: author.id })
      .returning()

    // All three share one createdAt to reproduce the ms-resolution tie that
    // the `seq` identity column (see schema comment) is there to break —
    // Postgres has no rowid, so insertion order is carried by seq instead.
    const sameInstant = Date.now()
    await client.db.insert(circleMessages).values([
      { circleId: circle.id, userId: author.id, body: 'first', createdAt: sameInstant },
      { circleId: circle.id, userId: author.id, body: 'second', createdAt: sameInstant },
      { circleId: circle.id, userId: author.id, body: 'third', createdAt: sameInstant },
    ])

    const rows = await client.db
      .select({ body: circleMessages.body })
      .from(circleMessages)
      .where(eq(circleMessages.circleId, circle.id))
      .orderBy(asc(circleMessages.seq))

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
