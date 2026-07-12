import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestClient } from '../src/client.js'
import type { CuatroClient } from '../src/client.js'
import { venues } from '../src/schema/index.js'
import { isPlausibleVenueName, seedUkVenues, SEED_ATTRIBUTION, type UkVenueSeedRow } from '../src/seed-venues-uk.js'
import { seed } from '../src/seed.js'

describe('seed-venues-uk', () => {
  let client: CuatroClient
  let db: CuatroClient['db']

  beforeEach(async () => {
    client = await createTestClient()
    db = client.db
  })
  afterEach(async () => {
    await client.close()
  })

  const rows: UkVenueSeedRow[] = [
    // OSM-shape (city/osmPostcode, no address) with a pin + facts.
    { name: 'Club de Padel', city: 'Manchester', osmPostcode: 'M15 4YB', lat: 53.47, lng: -2.25, indoorOutdoor: 'indoor', courts: 2 },
    // Merged-shape (address/countryCode/timezone/sources).
    { name: 'Rocket Padel', address: 'Bristol, BS4 4EB', postcode: 'BS4 4EB', lat: 51.45, lng: -2.54, indoorOutdoor: 'indoor', courts: 16, countryCode: 'GB', timezone: 'Europe/London', sources: ['OSM', 'LTA'] },
    // Unnamed + pitch-label rows: dropped.
    { name: null, postcode: 'SK9 3PE', lat: 53.34, lng: -2.19 },
    { name: 'Court 9', postcode: 'E14 4DE', lat: 51.5, lng: -0.02 },
    // LTA-tier row: postcode, NO lat/lng → inserted, awaiting geocode.
    { name: 'Highbury Padel', postcode: 'N5 1AA' },
  ]

  it('exports the OSM + LTA attribution string', () => {
    expect(SEED_ATTRIBUTION).toMatch(/OpenStreetMap/)
    expect(SEED_ATTRIBUTION).toMatch(/LTA/)
  })

  it('filters pitch/court labels but keeps real venue names', () => {
    expect(isPlausibleVenueName('Court 9')).toBe(false)
    expect(isPlausibleVenueName('Padel Court 3')).toBe(false)
    expect(isPlausibleVenueName('42')).toBe(false)
    expect(isPlausibleVenueName('')).toBe(false)
    expect(isPlausibleVenueName(null)).toBe(false)
    expect(isPlausibleVenueName('Rocket Padel')).toBe(true)
    expect(isPlausibleVenueName('Club de Padel')).toBe(true)
  })

  it('seeds plausible rows with facts + a unique slug, skipping unnamed/pitch labels', async () => {
    const result = await seedUkVenues(db, rows)
    expect(result).toEqual({ inserted: 3, skippedExisting: 0, skippedUnnamed: 2, missingLatLng: 1 })

    const all = await db.select().from(venues)
    expect(all.map((v) => v.name).sort()).toEqual(['Club de Padel', 'Highbury Padel', 'Rocket Padel'])
    expect(new Set(all.map((v) => v.slug)).size).toBe(3) // all slugged, all unique

    const rocket = all.find((v) => v.name === 'Rocket Padel')!
    expect(rocket.slug).toBe('rocket-padel')
    expect(rocket.indoorOutdoor).toBe('indoor')
    expect(rocket.courtCount).toBe(16)

    // LTA-tier row inserted without a pin (address carries the postcode).
    const highbury = all.find((v) => v.name === 'Highbury Padel')!
    expect(highbury.lat).toBeNull()
    expect(highbury.address).toBe('N5 1AA')
    expect(highbury.slug).toBeTruthy()
  })

  it('is idempotent: a second run inserts nothing new (name + postcode key)', async () => {
    await seedUkVenues(db, rows)
    const again = await seedUkVenues(db, rows)
    expect(again.inserted).toBe(0)
    expect(again.skippedExisting).toBe(3)
    expect((await db.select().from(venues)).length).toBe(3)
  })

  it('same-name proximity guard: postcode listing variance does not split a venue in two', async () => {
    await seedUkVenues(db, [
      { name: 'Powerleague Shoreditch', address: 'Bethnal Green Rd, London EC2A 3AR', lat: 51.5265, lng: -0.0805 },
    ])
    const result = await seedUkVenues(db, [
      // Same club, LTA lists a different postcode ~450m away → same venue, skipped.
      { name: 'Powerleague Shoreditch', postcode: 'E1 6GJ', lat: 51.5233, lng: -0.0757 },
      // Same name with no pin but a matching postcode district → same venue, skipped.
      { name: 'Powerleague Shoreditch', postcode: 'EC2A 4QS' },
      // Same-name CHAIN in another town (>1km, other district) → distinct, inserted.
      { name: 'Powerleague Shoreditch', postcode: 'M15 4YB', lat: 53.47, lng: -2.25 },
    ])
    expect(result.inserted).toBe(1)
    expect(result.skippedExisting).toBe(2)
    const all = await db.select().from(venues)
    expect(all.filter((v) => v.name === 'Powerleague Shoreditch').length).toBe(2)
  })

  it('never collides with the dev-fixture seed and disambiguates a shared slug', async () => {
    await seed(db) // 6 dev-fixture venues incl. slug "rocket-padel-wandsworth"
    const before = (await db.select().from(venues)).length
    // A UK row whose slug base clashes with a dev fixture gets a disambiguated slug.
    const result = await seedUkVenues(db, [
      { name: 'Rocket Padel', postcode: 'SW18 1UJ', lat: 51.45, lng: -0.19 }, // dev fixture is "Rocket Padel Wandsworth" @ same postcode → different name key, inserts
      { name: 'Powerleague Shoreditch', postcode: 'EC2A 3AR', lat: 51.52, lng: -0.08 }, // same name + postcode as a dev fixture → skipped
    ])
    expect(result.inserted).toBe(1)
    expect(result.skippedExisting).toBe(1)
    const all = await db.select().from(venues)
    expect(all.length).toBe(before + 1)
    expect(new Set(all.map((v) => v.slug)).size).toBe(all.length) // still all-unique slugs
  })
})
