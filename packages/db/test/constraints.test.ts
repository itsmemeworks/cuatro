import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circles, rsvps, sessions, users } from '../src/schema/index.js'

describe('unique constraints', () => {
  let client: CuatroClient

  beforeEach(async () => {
    client = await createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a duplicate circle invite_code', async () => {
    const [organiser] = await client.db
      .insert(users)
      .values({ email: 'organiser@example.com', displayName: 'Organiser' })
      .returning()

    await client.db.insert(circles).values({
      name: 'Circle One',
      inviteCode: 'DUPLICATE1',
      createdBy: organiser.id,
    })

    await expect(
      client.db.insert(circles).values({
        name: 'Circle Two',
        inviteCode: 'DUPLICATE1',
        createdBy: organiser.id,
      }),
    ).rejects.toThrow()
  })

  it('rejects a second rsvp from the same user for the same session', async () => {
    const [player] = await client.db
      .insert(users)
      .values({ email: 'player@example.com', displayName: 'Player' })
      .returning()
    const [circle] = await client.db
      .insert(circles)
      .values({ name: 'Test Circle', inviteCode: 'TESTCIRCLE', createdBy: player.id })
      .returning()
    const [session] = await client.db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt: Date.now(), status: 'upcoming' })
      .returning()

    await client.db.insert(rsvps).values({ sessionId: session.id, userId: player.id, status: 'in' })

    await expect(
      client.db.insert(rsvps).values({ sessionId: session.id, userId: player.id, status: 'out' }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate user email', async () => {
    await client.db.insert(users).values({ email: 'dup@example.com', displayName: 'First' })

    await expect(
      client.db.insert(users).values({ email: 'dup@example.com', displayName: 'Second' }),
    ).rejects.toThrow()
  })
})
