/**
 * THE ATLAS — UK venue seed (SEPARATE from the dev-fixture seed in seed.ts).
 *
 * Data-driven and IDEMPOTENT: it reads a dataset file of venue rows and inserts
 * the plausibly-named, geocodable ones as `venues`, skipping any that already
 * exist (idempotency key = normalised name + postcode). It never touches the
 * worked-example rating fixtures in seed.ts, so the two can run in either order.
 *
 * DATASET: pass `--file <path>` or set `SEED_VENUES_FILE`; otherwise it reads
 * the bundled `./data/uk-venues.json`. Swapping in the full merged LTA+OSM file
 * (same shape, plus `sources[]` per row) is a DATA-ONLY change — no code edit.
 * The row shape is tolerant of both the raw OSM export (city/osmPostcode, no
 * address) and the merged file (address/countryCode/timezone/sources):
 *   { name, postcode?, osmPostcode?, city?, address?, lat?, lng?,
 *     indoorOutdoor?, courts?, countryCode?, timezone?, source?, sources? }
 *
 * GEOCODING: LTA-tier rows may carry a postcode but no lat/lng. We insert them
 * anyway (address holds the postcode) with lat/lng null; the EXISTING forward-
 * geocode backfill (`npx tsx apps/web/src/server/geocode.ts`) pins them
 * afterwards. We do NOT geocode here — packages/db must not import from apps/web
 * (wrong dependency direction) and stays network-free.
 *
 * SLUGS: generated in-package (a small copy of apps/web/src/server/venues.ts's
 * slugify + unique-slug logic) for the same reason — packages/db can't import
 * upward. Kept in sync by shape, not by import; see the manifest note.
 *
 * ATTRIBUTION: seeded rows are OpenStreetMap (ODbL) locations enriched with LTA
 * venue data — surface `SEED_ATTRIBUTION` wherever the map renders.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './client.js'
import type { CuatroDb } from './client.js'
import { venues } from './schema/index.js'
import type { IndoorOutdoor } from './schema/venues.js'

/** Map-surface attribution for the seeded dataset (locations from OSM, venue data from the LTA). */
export const SEED_ATTRIBUTION =
  'Venue locations © OpenStreetMap contributors (ODbL). Venue data: LTA.'

/** A single dataset row. Every field bar `name` is optional; shapes vary by tier. */
export interface UkVenueSeedRow {
  name?: string | null
  postcode?: string | null
  osmPostcode?: string | null
  city?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  indoorOutdoor?: IndoorOutdoor | null
  courts?: number | null
  countryCode?: string | null
  timezone?: string | null
  source?: string | null
  sources?: string[] | null
}

export interface SeedUkVenuesResult {
  inserted: number
  skippedExisting: number
  skippedUnnamed: number
  /** Inserted rows carrying a postcode but no lat/lng — pinned later by the geocode backfill. */
  missingLatLng: number
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i

/** Normalise a postcode to "OUT IN" upper-case, from an explicit value or a free-text address. Null if none. */
function normalisePostcode(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue
    const m = c.match(UK_POSTCODE_RE)
    if (m) return `${m[1]} ${m[2]}`.toUpperCase()
  }
  return null
}

/** Idempotency key: normalised name + postcode. Two rows with the same key are the same venue. */
function idKey(name: string, postcode: string | null): string {
  return `${nameKey(name)}|${postcode ?? ''}`
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Postcode district ("CM23" from "CM23 5QZ"). */
function outcode(postcode: string | null): string | null {
  return postcode ? postcode.split(' ')[0] : null
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const s =
    Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(s))
}

/**
 * Same-name proximity guard: postcode listing variance (LTA "E1 6GJ" vs a
 * user-pinned "EC2A 3AR" for the same club) slips past the name+postcode key
 * and splits a venue in two — "one venue, one page" is the product law. A row
 * whose normalised name already exists counts as the SAME venue when both are
 * pinned within 1 km, or when either lacks a pin but they share a postcode
 * district. Same-name chains in different towns stay distinct.
 */
const SAME_VENUE_KM = 1.0

type NamePin = { lat: number | null; lng: number | null; out: string | null }

function isSameVenueNearby(row: UkVenueSeedRow, postcode: string | null, pins: NamePin[]): boolean {
  return pins.some((v) => {
    if (row.lat != null && row.lng != null && v.lat != null && v.lng != null) {
      return haversineKm(row.lat, row.lng, v.lat, v.lng) <= SAME_VENUE_KM
    }
    const o = outcode(postcode)
    return !!o && o === v.out
  })
}

/**
 * World-ready slug stem (copy of apps/web/src/server/venues.ts slugifyVenueName):
 * diacritics folded, non-letter/number runs → single hyphen, trimmed.
 */
function slugifyVenueName(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** A unique slug given the slugs already taken (mutates nothing; caller records the result). */
function uniqueSlug(name: string, disambiguator: string | null, taken: Set<string>): string {
  const base = slugifyVenueName(name) || 'venue'
  if (!taken.has(base)) return base
  const area = slugifyVenueName(disambiguator)
  if (area) {
    const withArea = `${base}-${area}`
    if (!taken.has(withArea)) return withArea
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Is this a real venue NAME, not a pitch/court label? The OSM export mislabels
 * some rows with the individual court name ("Court 9", "Padel Court 3") or a
 * bare number; those are not venues. Requires a non-empty name that isn't a
 * pure "court/pitch N" label and carries at least one word-like token.
 */
export function isPlausibleVenueName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return false
  if (/^(padel\s+|tennis\s+)?(court|pitch|cancha|pista)\s*\d+$/i.test(n)) return false
  if (/^\d+$/.test(n)) return false
  return /[\p{L}]{2,}/u.test(n)
}

/** Build a display address from an explicit address, else city + postcode. */
function buildAddress(row: UkVenueSeedRow, postcode: string | null): string | null {
  if (row.address?.trim()) return row.address.trim()
  const parts = [row.city?.trim(), postcode].filter((p): p is string => !!p)
  return parts.length ? parts.join(', ') : null
}

/**
 * Seed UK venues from `rows` into `db`, idempotently. Existing venues (by
 * normalised name + postcode) are left untouched; unnamed/pitch-label rows are
 * skipped. Slugs are generated unique against existing + newly-seeded rows.
 * Rows without lat/lng are still inserted (address carries the postcode) for
 * the geocode backfill to pin. Pure DB access — no network.
 */
export async function seedUkVenues(db: CuatroDb, rows: UkVenueSeedRow[]): Promise<SeedUkVenuesResult> {
  const existing = await db.select().from(venues)
  const existingKeys = new Set(existing.map((v) => idKey(v.name, normalisePostcode(v.address))))
  const takenSlugs = new Set(existing.map((v) => v.slug).filter((s): s is string => !!s))
  const pinsByName = new Map<string, NamePin[]>()
  for (const v of existing) {
    const k = nameKey(v.name)
    const list = pinsByName.get(k) ?? []
    list.push({ lat: v.lat, lng: v.lng, out: outcode(normalisePostcode(v.address)) })
    pinsByName.set(k, list)
  }

  let skippedExisting = 0
  let skippedUnnamed = 0
  let missingLatLng = 0
  const toInsert: (typeof venues.$inferInsert)[] = []

  for (const row of rows) {
    if (!isPlausibleVenueName(row.name)) {
      skippedUnnamed++
      continue
    }
    const name = row.name!.trim()
    const postcode = normalisePostcode(row.postcode, row.osmPostcode, row.address)
    const key = idKey(name, postcode)
    if (existingKeys.has(key)) {
      skippedExisting++
      continue
    }
    const namePins = pinsByName.get(nameKey(name)) ?? []
    if (isSameVenueNearby(row, postcode, namePins)) {
      skippedExisting++
      continue
    }
    existingKeys.add(key) // dedupe within the batch too
    namePins.push({ lat: row.lat ?? null, lng: row.lng ?? null, out: outcode(postcode) })
    pinsByName.set(nameKey(name), namePins)

    const address = buildAddress(row, postcode)
    const slug = uniqueSlug(name, postcode ?? address, takenSlugs)
    takenSlugs.add(slug)

    const hasPin = row.lat != null && row.lng != null
    if (!hasPin) missingLatLng++

    toInsert.push({
      name,
      slug,
      address,
      lat: hasPin ? row.lat! : null,
      lng: hasPin ? row.lng! : null,
      indoorOutdoor: row.indoorOutdoor ?? null,
      // "courts" is a soft cluster-count proxy, not a verified court count.
      courtCount: typeof row.courts === 'number' ? row.courts : null,
      countryCode: row.countryCode?.trim() || 'GB',
      timezone: row.timezone?.trim() || 'Europe/London',
    })
  }

  if (toInsert.length > 0) await db.insert(venues).values(toInsert)
  return { inserted: toInsert.length, skippedExisting, skippedUnnamed, missingLatLng }
}

/** Resolve the dataset path: `--file <path>` arg, then SEED_VENUES_FILE env, then the bundled default. */
function resolveDatasetPath(): string {
  const argIdx = process.argv.indexOf('--file')
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]
  if (process.env.SEED_VENUES_FILE) return process.env.SEED_VENUES_FILE
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'uk-venues.json')
}

async function main() {
  const datasetPath = resolveDatasetPath()
  const rows = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as UkVenueSeedRow[]
  const { db, close } = await createClient()
  try {
    const result = await seedUkVenues(db, rows)
    console.log(
      `[@cuatro/db] UK venue seed from ${datasetPath}: ` +
        `+${result.inserted} inserted, ${result.skippedExisting} already present, ` +
        `${result.skippedUnnamed} unnamed/pitch-label skipped, ${result.missingLatLng} awaiting geocode.`,
    )
  } finally {
    await close()
  }
}

// Run only when executed directly (`tsx src/seed-venues-uk.ts`), not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
