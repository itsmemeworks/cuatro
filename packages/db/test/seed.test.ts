import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circles, ratingEvents, users } from '../src/schema/index.js'
import { seed } from '../src/seed.js'

describe('seed', () => {
  let client: CuatroClient

  beforeEach(async () => {
    client = await createTestClient()
    await seed(client.db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('inserts 12 users and 3 circles', async () => {
    const allUsers = await client.db.select().from(users)
    const allCircles = await client.db.select().from(circles)
    expect(allUsers).toHaveLength(12)
    expect(allCircles).toHaveLength(3)
  })

  it('resolves circle -> members -> users through the relational query API', async () => {
    const circle = await client.db.query.circles.findFirst({
      where: eq(circles.inviteCode, 'SHOREDITCH4'),
      with: { members: { with: { user: true } } },
    })

    expect(circle).toBeDefined()
    expect(circle!.members.length).toBeGreaterThanOrEqual(7)
    expect(circle!.members.map((m) => m.user.displayName)).toContain('Alex Kane')
  })

  it('returns a user rating_events history ordered by createdAt (the Ledger)', async () => {
    const alex = await client.db.query.users.findFirst({
      where: eq(users.displayName, 'Alex Kane'),
    })
    expect(alex).toBeDefined()

    const ledger = await client.db.query.ratingEvents.findMany({
      where: eq(ratingEvents.userId, alex!.id),
      orderBy: asc(ratingEvents.createdAt),
    })

    expect(ledger).toHaveLength(1)
    expect(ledger[0].ratingAfter).toBe(alex!.rating)
    expect(ledger[0].explanation).toMatch(/vs Jordan, Kwame/)
  })

  it('leaves a mid-Placement player Unrated in users.rating despite a real Ledger entry', async () => {
    const lucia = await client.db.query.users.findFirst({
      where: eq(users.displayName, 'Lucia Fernandez'),
    })
    expect(lucia).toBeDefined()
    expect(lucia!.rating).toBeNull()
    expect(lucia!.placementPriorRating).toBe(3.4)

    const ledger = await client.db.query.ratingEvents.findFirst({
      where: eq(ratingEvents.userId, lucia!.id),
    })
    expect(ledger).toBeDefined()
    expect(ledger!.ratingAfter).toBe(3.3)
    expect(ledger!.ratingBefore).toBeNull()
  })
})
