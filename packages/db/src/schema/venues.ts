import { real, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn } from './_columns.js'

// Free-text name + optional place metadata at v0 (we don't own a club
// directory yet) but stored as a first-class table ready to become one.
export const venues = pgTable('venues', {
  id: idColumn(),
  name: text('name').notNull(),
  placeId: text('place_id'), // external place lookup id (e.g. Google Place ID), optional
  address: text('address'),
  lat: real('lat'),
  lng: real('lng'),
  countryCode: text('country_code').notNull().default('GB'),
  timezone: text('timezone').notNull().default('Europe/London'),
  createdAt: createdAtColumn(),
})

export type Venue = typeof venues.$inferSelect
export type NewVenue = typeof venues.$inferInsert
