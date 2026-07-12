import { sql } from 'drizzle-orm'
import { check, index, real, pgTable, text, integer } from 'drizzle-orm/pg-core'
import { booleanColumn, createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { venues } from './venues.js'

// A player's auth identity, GLASS rating state, and reliability counters.
// GLASS fields start empty — `rating` is null until the Placement Trio (first
// 3 verified matches) resolves it; see rating_events for the append-only ledger
// that explains every subsequent movement.
export const users = pgTable(
  'users',
  {
    id: idColumn(),

    // Auth identity. Nullable: a guest claimed via a public game link (see
    // server/guest.ts) gets a row with no email at all — SQLite's unique
    // index treats every NULL as distinct, so many guest rows can coexist.
    // `isGuest` is the row's actual identity flag; `email == null` is just
    // the consequence of never having signed in.
    email: text('email').unique(),
    emailVerifiedAt: timestampColumn('email_verified_at'),
    oauthGoogleId: text('oauth_google_id').unique(),
    oauthAppleId: text('oauth_apple_id').unique(),
    // Supabase Auth's own user id (auth.users.id) — the primary identity once
    // Supabase Auth is live. Nullable: legacy-flow accounts (created via the
    // custom magic-link store, AUTH_LEGACY=1) never set this; a Supabase
    // login later links onto the same row by email instead of duplicating it.
    supabaseUserId: text('supabase_user_id').unique(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),

    // Guest identity (join-via-link's "10-second promise" — no account, no
    // password, no email). `isGuest` is true from the claim tap until the
    // deferred magic-link conversion at /auth/callback flips it back to
    // false. `guestClaimTokenHash` is the sha256 of the raw token held in
    // the guest's `cuatro_guest` device cookie (see server/guest.ts) — same
    // "store the hash, never the raw token" pattern as magic_link_tokens/
    // sessions_auth in auth.ts. Cleared on conversion so a stale cookie from
    // a since-converted guest can never re-resolve to this row.
    isGuest: booleanColumn('is_guest').notNull().default(false),
    guestClaimTokenHash: text('guest_claim_token_hash').unique(),

    // World-ready plumbing: country is data, not code.
    countryCode: text('country_code').notNull().default('GB'),
    locale: text('locale').notNull().default('en-GB'),

    // Geo discovery (venue-anchored, NEVER device GPS). `findable` is
    // on-by-default — but discovery only becomes *active* once a patch
    // resolves (see server/patch.ts): a home-venue pin, else an explicit
    // chosen area (patchLat/patchLng), else an inferred pin from where they
    // actually play. A findable user with no resolvable patch is simply not
    // placed on the map yet. Guests (is_guest) are excluded from discovery in
    // QUERIES, not here. `homeVenueId` is the player's anchor club; its
    // lat/lng (once geocoded) is the pin. patchLat/patchLng is the fallback
    // "I play around here" point when there's no single home venue.
    findable: booleanColumn('findable').notNull().default(true),
    homeVenueId: text('home_venue_id').references(() => venues.id),
    patchLat: real('patch_lat'),
    patchLng: real('patch_lng'),
    // THE ATLAS patch size — how far "near you" reaches on the map. A coarse,
    // human control (never a km slider); the three values map to fixed radii
    // in apps/web/src/lib/geo.ts (PATCH_SIZES). Default 'local'.
    patchSize: text('patch_size', { enum: ['tight', 'local', 'wide'] })
      .notNull()
      .default('local'),

    // GLASS rating state
    // `rating` is null while Unrated (before the Placement Trio completes).
    rating: real('rating'),
    confidence: real('confidence').notNull().default(0),
    verifiedMatchCount: integer('verified_match_count').notNull().default(0),
    // One-time Playtomic import ("I'm a 3.4") — seeds the Placement prior only,
    // never displayed as Glass itself.
    placementPriorRating: real('placement_prior_rating'),

    // Reliability: show-up rate + RSVP discipline, kept as raw counters so the
    // badge (e.g. "✓ 97%") is always derivable and auditable.
    rsvpInCount: integer('rsvp_in_count').notNull().default(0),
    showUpCount: integer('show_up_count').notNull().default(0),
    // Confirmed-then-cancelled inside 24h; genuine early cancels don't count.
    lateCancelCount: integer('late_cancel_count').notNull().default(0),

    // Player attributes (GitHub issue #21): dominant hand and preferred court
    // side. Both optional and nullable FOREVER, and SOFT SIGNALS ONLY — they
    // never gate joining anything, never filter a Fourth Call, and never
    // affect Glass, rotation, or matchmaking. Padel lingo: court side
    // 'right' = drive, 'left' = backhand. Vocab lives in
    // apps/web/src/lib/player-attrs.ts.
    dominantHand: text('dominant_hand', { enum: ['left', 'right', 'both'] }),
    courtSide: text('court_side', { enum: ['right', 'left', 'both'] }),

    // Per-type notification preferences (the Settings NOTIFICATIONS card).
    // Default ON — opting out means server/notify.ts creates NOTHING for that
    // type (no row, no push, no realtime). Only these three are user-facing
    // choices; every other notification type is a consequence of the user's
    // own commitments (seals, promotions, knocks, ...) and stays always-on.
    // Enforcement lives in apps/web/src/server/notify.ts, the one place every
    // notification is written.
    notifyFourthCall: booleanColumn('notify_fourth_call').notNull().default(true),
    notifyRotation: booleanColumn('notify_rotation').notNull().default(true),
    notifyTabNudge: booleanColumn('notify_tab_nudge').notNull().default(true),

    createdAt: createdAtColumn(),
    updatedAt: createdAtColumn('updated_at'),
  },
  (table) => ({
    countryCodeIdx: index('users_country_code_idx').on(table.countryCode),
    dominantHandCheck: check(
      'users_dominant_hand_check',
      sql`${table.dominantHand} in ('left', 'right', 'both')`,
    ),
    courtSideCheck: check(
      'users_court_side_check',
      sql`${table.courtSide} in ('right', 'left', 'both')`,
    ),
    patchSizeCheck: check(
      'users_patch_size_check',
      sql`${table.patchSize} in ('tight', 'local', 'wide')`,
    ),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
