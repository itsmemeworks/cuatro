import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circles, rsvps, sessions, standingGames, users } from '../src/schema/index.js'

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

// Issue #21 columns (migration 0003): hand/side on users, "Booked on" on
// standing_games + sessions, Fourth Call side hint on sessions. All nullable
// forever (null = unset is the default state); the CHECK constraints are the
// backstop against crafted values slipping past the service layer.
describe('issue #21 check constraints (hand/side, booking, side hint)', () => {
  let client: CuatroClient

  beforeEach(async () => {
    client = await createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  async function seedCircleAndUser() {
    const [user] = await client.db.insert(users).values({ email: 'p@example.com', displayName: 'P' }).returning()
    const [circle] = await client.db
      .insert(circles)
      .values({ name: 'C', inviteCode: 'CHECKS1', createdBy: user.id })
      .returning()
    return { user, circle }
  }

  it('accepts valid hand/side values and nulls, rejects unknown ones', async () => {
    const [ok] = await client.db
      .insert(users)
      .values({ email: 'ok@example.com', displayName: 'OK', dominantHand: 'left', courtSide: 'right' })
      .returning()
    expect(ok.dominantHand).toBe('left')
    expect(ok.courtSide).toBe('right')

    const [unset] = await client.db.insert(users).values({ email: 'unset@example.com', displayName: 'U' }).returning()
    expect(unset.dominantHand).toBeNull()
    expect(unset.courtSide).toBeNull()

    await expect(
      client.db.insert(users).values({
        email: 'bad@example.com',
        displayName: 'Bad',
        // crafted value — the CHECK constraint is the backstop
        dominantHand: 'tentacle' as never,
      }),
    ).rejects.toThrow()
    await expect(
      client.db.insert(users).values({
        email: 'bad2@example.com',
        displayName: 'Bad',
        // crafted value
        courtSide: 'middle' as never,
      }),
    ).rejects.toThrow()
  })

  it('accepts known booking platforms on standing_games and sessions, rejects unknown ones', async () => {
    const { circle } = await seedCircleAndUser()

    const [sg] = await client.db
      .insert(standingGames)
      .values({ circleId: circle.id, weekday: 2, startTime: '20:00', bookingPlatform: 'playtomic', bookingUrl: 'https://playtomic.io/x' })
      .returning()
    expect(sg.bookingPlatform).toBe('playtomic')

    await expect(
      client.db.insert(standingGames).values({
        circleId: circle.id,
        weekday: 3,
        startTime: '19:00',
        // crafted value
        bookingPlatform: 'skynet' as never,
      }),
    ).rejects.toThrow()

    const [session] = await client.db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt: Date.now(), status: 'upcoming', bookingPlatform: 'matchi' })
      .returning()
    expect(session.bookingPlatform).toBe('matchi')

    await expect(
      client.db.insert(sessions).values({
        circleId: circle.id,
        startsAt: Date.now(),
        status: 'upcoming',
        // crafted value
        bookingPlatform: 'carrier_pigeon' as never,
      }),
    ).rejects.toThrow()
  })

  it("limits fourth_call_side_hint to 'left'/'right' (a pair seat, never 'both')", async () => {
    const { circle } = await seedCircleAndUser()

    const [session] = await client.db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt: Date.now(), status: 'upcoming', fourthCallSideHint: 'left' })
      .returning()
    expect(session.fourthCallSideHint).toBe('left')

    await expect(
      client.db.insert(sessions).values({
        circleId: circle.id,
        startsAt: Date.now(),
        status: 'upcoming',
        // 'both' is not a seat you can hint for
        fourthCallSideHint: 'both' as never,
      }),
    ).rejects.toThrow()
  })
})
