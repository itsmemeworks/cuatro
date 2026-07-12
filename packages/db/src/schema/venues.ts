import { sql } from 'drizzle-orm'
import { check, integer, real, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn } from './_columns.js'

// The set of court-environment facts a venue can carry. Community-filled and
// OPTIONAL by design (nullable forever) — the Atlas earns its facts as players
// call a court home, it never blocks a court for lacking them.
export const INDOOR_OUTDOOR = ['indoor', 'outdoor', 'mixed'] as const
export type IndoorOutdoor = (typeof INDOOR_OUTDOOR)[number]

// Free-text name + optional place metadata at v0 (we don't own a club
// directory yet) but stored as a first-class table ready to become one.
export const venues = pgTable(
  'venues',
  {
    id: idColumn(),
    name: text('name').notNull(),
    // URL-safe stable handle for a venue's shareable court page
    // (cuatro.app/courts/<slug>). Unique; generated from the name plus an
    // area/postcode-district disambiguator at creation (see
    // server/venues.ts generateVenueSlug), backfilled for existing rows by
    // migration 0005. Nullable at the DB level so a raw insert never 500s,
    // but every creation path fills it and the boot migration leaves no null
    // slugs behind.
    slug: text('slug').unique(),
    placeId: text('place_id'), // external place lookup id (e.g. Google Place ID), optional
    address: text('address'),
    lat: real('lat'),
    lng: real('lng'),
    // Community-filled court facts (THE ATLAS). Both optional/nullable — a
    // court with no facts is a normal, valid court.
    indoorOutdoor: text('indoor_outdoor', { enum: INDOOR_OUTDOOR }),
    courtCount: integer('court_count'),
    countryCode: text('country_code').notNull().default('GB'),
    timezone: text('timezone').notNull().default('Europe/London'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    // drizzle's `enum:` only shapes the TS union; the value set is pinned at
    // the DB with an explicit CHECK (matching the game_type pattern).
    indoorOutdoorCheck: check(
      'venues_indoor_outdoor_check',
      sql`${table.indoorOutdoor} in ('indoor', 'outdoor', 'mixed')`,
    ),
  }),
)

export type Venue = typeof venues.$inferSelect
export type NewVenue = typeof venues.$inferInsert
