import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { booleanColumn, createdAtColumn, idColumn } from './_columns.js'
import { circles } from './circles.js'
import { venues } from './venues.js'

// The recurring fixture, e.g. "Tuesdays 20:00, Powerleague Shoreditch, 4
// slots." Court booking itself stays wherever it is today — this table holds
// the *people*, not the booking.
export const standingGames = sqliteTable(
  'standing_games',
  {
    id: idColumn(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    venueId: text('venue_id').references(() => venues.id),
    weekday: integer('weekday').notNull(), // 0 = Sunday .. 6 = Saturday
    startTime: text('start_time').notNull(), // "HH:MM" local to the Circle/venue timezone
    durationMinutes: integer('duration_minutes').notNull().default(90),
    slots: integer('slots').notNull().default(4),
    rsvpWindowDays: integer('rsvp_window_days').notNull().default(6),
    active: booleanColumn('active').notNull().default(true),
    // The court cost for one occurrence (design/DESIGN-AUDIT.md F4) — null
    // means the organiser hasn't set a price, so no "goes on the Tab" split
    // can be offered. World-ready rule: minor units + ISO 4217, never a
    // float (see packages/db/src/schema/tabs.ts's amount_minor precedent).
    costMinor: integer('cost_minor'),
    costCurrency: text('cost_currency').notNull().default('GBP'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    circleIdIdx: index('standing_games_circle_id_idx').on(table.circleId),
  }),
)

export type StandingGame = typeof standingGames.$inferSelect
export type NewStandingGame = typeof standingGames.$inferInsert
