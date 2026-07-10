import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { circles, knocks, users, venues } from '../src/schema/index.js'

// Geo columns default sensibly (findable on-by-default, anchors null) and the
// `knocks` table enforces one OPEN knock per target via a partial unique index.
describe('geo schema', () => {
  let client: CuatroClient

  beforeEach(async () => {
    client = await createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  it('defaults findable to true and geo anchors to null on a plain user', async () => {
    const [u] = await client.db
      .insert(users)
      .values({ email: 'geo@example.com', displayName: 'Geo' })
      .returning()
    expect(u.findable).toBe(true)
    expect(u.homeVenueId).toBeNull()
    expect(u.patchLat).toBeNull()
    expect(u.patchLng).toBeNull()
  })

  it('defaults boardEnabled and openDoor to true and vibeLine to null on a circle', async () => {
    const [owner] = await client.db
      .insert(users)
      .values({ email: 'owner@example.com', displayName: 'Owner' })
      .returning()
    const [c] = await client.db
      .insert(circles)
      .values({ name: 'C', inviteCode: 'BOARDC1', createdBy: owner.id })
      .returning()
    expect(c.boardEnabled).toBe(true)
    expect(c.openDoor).toBe(true)
    expect(c.vibeLine).toBeNull()
  })

  it('lets a user anchor to a home venue', async () => {
    const [v] = await client.db
      .insert(venues)
      .values({ name: 'Club', address: 'London EC2A 3AR', lat: 51.5265, lng: -0.0805 })
      .returning()
    const [u] = await client.db
      .insert(users)
      .values({ email: 'home@example.com', displayName: 'Home', homeVenueId: v.id })
      .returning()
    expect(u.homeVenueId).toBe(v.id)
  })

  it('rejects a second OPEN knock on the same target from the same user', async () => {
    const [u] = await client.db
      .insert(users)
      .values({ email: 'knocker@example.com', displayName: 'Knocker' })
      .returning()
    await client.db.insert(knocks).values({ kind: 'circle', targetId: 'circle-1', userId: u.id })
    await expect(
      client.db.insert(knocks).values({ kind: 'circle', targetId: 'circle-1', userId: u.id }),
    ).rejects.toThrow()
  })

  it('allows a re-knock after the first is withdrawn (partial index)', async () => {
    const [u] = await client.db
      .insert(users)
      .values({ email: 'reknock@example.com', displayName: 'Reknock' })
      .returning()
    const [first] = await client.db
      .insert(knocks)
      .values({ kind: 'session', targetId: 'session-1', userId: u.id })
      .returning()
    await client.db
      .update(knocks)
      .set({ status: 'withdrawn', decidedAt: Date.now() })
      .where(eq(knocks.id, first.id))
    await expect(
      client.db.insert(knocks).values({ kind: 'session', targetId: 'session-1', userId: u.id }),
    ).resolves.toBeDefined()
  })
})
