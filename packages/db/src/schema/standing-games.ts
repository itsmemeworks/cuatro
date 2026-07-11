import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core'
import { booleanColumn, createdAtColumn, gameTypeColumn, idColumn } from './_columns.js'
import { circles } from './circles.js'
import { venues } from './venues.js'

// The recurring fixture, e.g. "Tuesdays 20:00, Powerleague Shoreditch, 4
// slots." Court booking itself stays wherever it is today — this table holds
// the *people*, not the booking.
export const standingGames = pgTable(
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
    // THE ROTATION: when on, the weekly RSVP stops being first-come-holds-a-slot
    // and becomes "I'm available" / "not this week" — CUATRO then picks a fair
    // four from the available (fewest recent plays first) and locks it at the
    // configured cutoff. Default OFF so existing games keep first-come behaviour.
    rotationEnabled: booleanColumn('rotation_enabled').notNull().default(false),
    // How long before kickoff the rotation lineup resolves/locks (organiser-set,
    // e.g. "1 day"). Only meaningful when rotationEnabled and rotationMode =
    // 'limited'. Default 24h before kickoff.
    rotationCutoffHours: integer('rotation_cutoff_hours').notNull().default(24),
    // 'limited' (default): the lineup LOCKS at the cutoff (startsAt −
    // rotationCutoffHours). 'unlimited': it never locks — the fair-share
    // ranking keeps re-applying to availability changes right up to kickoff.
    rotationMode: text('rotation_mode', { enum: ['limited', 'unlimited'] }).notNull().default('limited'),
    // The court cost for one occurrence (design/DESIGN-AUDIT.md F4) — null
    // means the organiser hasn't set a price, so no "goes on the Tab" split
    // can be offered. World-ready rule: minor units + ISO 4217, never a
    // float (see packages/db/src/schema/tabs.ts's amount_minor precedent).
    costMinor: integer('cost_minor'),
    costCurrency: text('cost_currency').notNull().default('GBP'),
    // "Booked on" signpost (GitHub issue #21): where the booking and payment
    // actually live. Money on a game is OPT-IN and mutually exclusive: a game
    // carries a booking signpost XOR a court cost, never both — a booked-on
    // game never touches the Tab. The XOR is enforced in the service layer
    // (server/standing-games-service.ts), not here, because setting one must
    // CLEAR the other. Platform list is data (apps/web/src/lib/booking.ts) —
    // world-ready, no UK assumptions.
    bookingPlatform: text('booking_platform', {
      enum: ['playtomic', 'padel_mates', 'matchi', 'padium', 'club_website', 'other'],
    }),
    bookingUrl: text('booking_url'),
    // FRIENDLIES (V1-READINESS #10): this fixture's classification, set from the
    // circle's default at creation and overridable per Standing Game. Every
    // session materialised from this game inherits it (see games-service.ts
    // ensureUpcomingSessionForStandingGame).
    gameType: gameTypeColumn('game_type'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    circleIdIdx: index('standing_games_circle_id_idx').on(table.circleId),
    gameTypeCheck: check(
      'standing_games_game_type_check',
      sql`${table.gameType} in ('competitive', 'friendly')`,
    ),
    bookingPlatformCheck: check(
      'standing_games_booking_platform_check',
      sql`${table.bookingPlatform} in ('playtomic', 'padel_mates', 'matchi', 'padium', 'club_website', 'other')`,
    ),
  }),
)

export type StandingGame = typeof standingGames.$inferSelect
export type NewStandingGame = typeof standingGames.$inferInsert
