import { createClient } from './client.js'
import type { CuatroDb } from './client.js'
import {
  circleMembers,
  circles,
  matchConfirmations,
  matches,
  notifications,
  ratingEvents,
  rsvps,
  sessions,
  standingGames,
  tabEntries,
  tabs,
  users,
  venues,
} from './schema/index.js'

const DAY_MS = 24 * 60 * 60 * 1000
const uuid = () => crypto.randomUUID()

// Dev fixtures: two Circles, a Standing Game each, a handful of sessions
// (played + upcoming), three verified matches whose rating_events are the
// *last* seeded event for every player involved — so each player's stored
// `users.rating`/`confidence` matches the Ledger's most recent entry for them.
export async function seed(db: CuatroDb) {
  const now = Date.now()

  // ---- Venue ids (declared first so users can anchor a home venue) ----
  // Real London coords + postcodes so geo discovery has something to resolve
  // against without a network round-trip at seed time. Spread across ~16 km
  // so radius filtering is genuinely exercised: Shoreditch↔Stratford ≈ 5 km
  // (inside the 10 km default), Shoreditch↔Wandsworth ≈ 11 km (just OUTSIDE
  // it — a deliberate boundary case), Stratford↔Wandsworth ≈ 16 km.
  const shoreditchVenueId = uuid()
  const wandsworthVenueId = uuid()
  const stratfordVenueId = uuid()

  // `home`/`patch`/`findable` seed the geo-discovery branches:
  //  - home venue pin: most players anchor to their circle's club.
  //  - explicit patch: Ben & Lucia (Lucia unrated) pick an area near Stratford.
  //  - inferred: Tom has neither, but plays at Shoreditch, so resolvePatch
  //    infers it from his sessions.
  //  - opted out: Marcus is findable=false — discovery queries must skip him.
  const STRATFORD = { lat: 51.5432, lng: -0.0125 }
  const userSeeds = [
    { displayName: 'Alex Kane', email: 'alex.kane@example.com', rating: 4.1, confidence: 0.72, verifiedMatchCount: 18, home: shoreditchVenueId },
    { displayName: 'Priya Shah', email: 'priya.shah@example.com', rating: 3.7, confidence: 0.64, verifiedMatchCount: 14, home: shoreditchVenueId },
    { displayName: 'Jordan Ma', email: 'jordan.ma@example.com', rating: 3.95, confidence: 0.8, verifiedMatchCount: 22, home: shoreditchVenueId },
    { displayName: 'Kwame Osei', email: 'kwame.osei@example.com', rating: 3.65, confidence: 0.56, verifiedMatchCount: 11, home: shoreditchVenueId },
    { displayName: 'Sofia Reyes', email: 'sofia.reyes@example.com', rating: 3.4, confidence: 0.48, verifiedMatchCount: 9, home: shoreditchVenueId },
    { displayName: 'Ben Whitfield', email: 'ben.whitfield@example.com', rating: 2.9, confidence: 0.32, verifiedMatchCount: 5, lateCancelCount: 1, patchLat: STRATFORD.lat, patchLng: STRATFORD.lng },
    { displayName: 'Lucia Fernandez', email: 'lucia.fernandez@example.com', rating: null, confidence: 0.08, verifiedMatchCount: 1, placementPriorRating: 3.4, patchLat: STRATFORD.lat, patchLng: STRATFORD.lng },
    { displayName: 'Tom Harker', email: 'tom.harker@example.com', rating: 3.25, confidence: 0.24, verifiedMatchCount: 3 },
    { displayName: 'Nadia Petrov', email: 'nadia.petrov@example.com', rating: 4.35, confidence: 0.88, verifiedMatchCount: 31, home: wandsworthVenueId },
    { displayName: 'Owen Blackwood', email: 'owen.blackwood@example.com', rating: 3.1, confidence: 0.4, verifiedMatchCount: 7, home: wandsworthVenueId },
    { displayName: 'Freya Lindqvist', email: 'freya.lindqvist@example.com', rating: 3.8, confidence: 0.68, verifiedMatchCount: 16, home: wandsworthVenueId },
    { displayName: 'Marcus Chen', email: 'marcus.chen@example.com', rating: null, confidence: 0.08, verifiedMatchCount: 1, lateCancelCount: 1, findable: false },
  ] as const

  const userRows = userSeeds.map((u) => ({
    id: uuid(),
    email: u.email,
    displayName: u.displayName,
    countryCode: 'GB',
    locale: 'en-GB',
    rating: u.rating,
    confidence: u.confidence,
    verifiedMatchCount: u.verifiedMatchCount,
    placementPriorRating: 'placementPriorRating' in u ? u.placementPriorRating : null,
    rsvpInCount: u.verifiedMatchCount + 4,
    showUpCount: u.verifiedMatchCount + 3,
    lateCancelCount: 'lateCancelCount' in u ? u.lateCancelCount : 0,
    findable: 'findable' in u ? u.findable : true,
    homeVenueId: 'home' in u ? u.home : null,
    patchLat: 'patchLat' in u ? u.patchLat : null,
    patchLng: 'patchLng' in u ? u.patchLng : null,
  }))

  // Venues must exist before users: a user's homeVenueId is a real FK.
  // (lat/lng hardcoded to real London points — see the id block at the top of
  // seed(). Addresses carry a real postcode too, so the postcodes.io backfill
  // would resolve the same pin if lat/lng were cleared.)
  const shoreditchVenue = {
    id: shoreditchVenueId,
    name: 'Powerleague Shoreditch',
    address: 'Bethnal Green Rd, London EC2A 3AR',
    lat: 51.5265,
    lng: -0.0805,
    countryCode: 'GB',
    timezone: 'Europe/London',
  }
  const wandsworthVenue = {
    id: wandsworthVenueId,
    name: 'Rocket Padel Wandsworth',
    address: 'Buckhold Rd, London SW18 1UJ',
    lat: 51.4571,
    lng: -0.1931,
    countryCode: 'GB',
    timezone: 'Europe/London',
  }
  const stratfordVenue = {
    id: stratfordVenueId,
    name: 'Padel Social Club Stratford',
    address: 'Queen Elizabeth Olympic Park, London E20 1EJ',
    lat: 51.5432,
    lng: -0.0125,
    countryCode: 'GB',
    timezone: 'Europe/London',
  }
  await db.insert(venues).values([shoreditchVenue, wandsworthVenue, stratfordVenue])

  await db.insert(users).values(userRows)

  const byName = (name: string) => {
    const row = userRows.find((u) => u.displayName === name)
    if (!row) throw new Error(`seed: missing user ${name}`)
    return row
  }

  const alex = byName('Alex Kane')
  const priya = byName('Priya Shah')
  const jordan = byName('Jordan Ma')
  const kwame = byName('Kwame Osei')
  const sofia = byName('Sofia Reyes')
  const ben = byName('Ben Whitfield')
  const lucia = byName('Lucia Fernandez')
  const tom = byName('Tom Harker')
  const nadia = byName('Nadia Petrov')
  const owen = byName('Owen Blackwood')
  const freya = byName('Freya Lindqvist')
  const marcus = byName('Marcus Chen')

  // ---- Circles ----
  const tuesdayCircle = {
    id: uuid(),
    name: 'Tuesday Shoreditch Crew',
    emblem: '🎾',
    colour: '#1F6FEB',
    countryCode: 'GB',
    timezone: 'Europe/London',
    inviteCode: 'SHOREDITCH4',
    vibeLine: 'Chilled Tuesday-night doubles in Shoreditch. All levels welcome.',
    createdBy: alex.id,
  }
  const weekendCircle = {
    id: uuid(),
    name: 'Weekend Wandsworth Four',
    emblem: '🏆',
    colour: '#D9822B',
    countryCode: 'GB',
    timezone: 'Europe/London',
    inviteCode: 'WANDSWORTH4',
    vibeLine: 'Saturday-morning weekend four in Wandsworth. Competitive but friendly.',
    createdBy: nadia.id,
  }
  await db.insert(circles).values([tuesdayCircle, weekendCircle])

  // Jordan plays in both — players belong to many Circles by design.
  await db.insert(circleMembers).values([
    ...[
      { name: 'Alex Kane', role: 'organiser' as const },
      { name: 'Priya Shah', role: 'member' as const },
      { name: 'Jordan Ma', role: 'member' as const },
      { name: 'Kwame Osei', role: 'member' as const },
      { name: 'Sofia Reyes', role: 'member' as const },
      { name: 'Ben Whitfield', role: 'member' as const },
      { name: 'Lucia Fernandez', role: 'member' as const },
      { name: 'Tom Harker', role: 'member' as const },
    ].map(({ name, role }, i) => ({
      circleId: tuesdayCircle.id,
      userId: byName(name).id,
      role,
      joinedAt: new Date(now - (40 - i) * DAY_MS),
    })),
    ...[
      { name: 'Nadia Petrov', role: 'organiser' as const },
      { name: 'Owen Blackwood', role: 'member' as const },
      { name: 'Freya Lindqvist', role: 'member' as const },
      { name: 'Marcus Chen', role: 'member' as const },
      { name: 'Jordan Ma', role: 'member' as const },
    ].map(({ name, role }, i) => ({
      circleId: weekendCircle.id,
      userId: byName(name).id,
      role,
      joinedAt: new Date(now - (25 - i) * DAY_MS),
    })),
  ])

  // ---- Standing Games ----
  const tuesdayStanding = {
    id: uuid(),
    circleId: tuesdayCircle.id,
    venueId: shoreditchVenue.id,
    weekday: 2, // Tuesday
    startTime: '20:00',
    durationMinutes: 90,
    slots: 4,
    rsvpWindowDays: 6,
    active: true,
  }
  const weekendStanding = {
    id: uuid(),
    circleId: weekendCircle.id,
    venueId: wandsworthVenue.id,
    weekday: 6, // Saturday
    startTime: '10:00',
    durationMinutes: 90,
    slots: 4,
    rsvpWindowDays: 6,
    active: true,
  }
  await db.insert(standingGames).values([tuesdayStanding, weekendStanding])

  // ---- Sessions ----
  const tuesdayPlayed1 = {
    id: uuid(),
    standingGameId: tuesdayStanding.id,
    circleId: tuesdayCircle.id,
    venueId: shoreditchVenue.id,
    startsAt: new Date(now - 14 * DAY_MS),
    status: 'played' as const,
  }
  const tuesdayPlayed2 = {
    id: uuid(),
    standingGameId: tuesdayStanding.id,
    circleId: tuesdayCircle.id,
    venueId: shoreditchVenue.id,
    startsAt: new Date(now - 7 * DAY_MS),
    status: 'played' as const,
  }
  const tuesdayUpcoming = {
    id: uuid(),
    standingGameId: tuesdayStanding.id,
    circleId: tuesdayCircle.id,
    venueId: shoreditchVenue.id,
    startsAt: new Date(now + 5 * DAY_MS),
    status: 'upcoming' as const,
  }
  const weekendPlayed1 = {
    id: uuid(),
    standingGameId: weekendStanding.id,
    circleId: weekendCircle.id,
    venueId: wandsworthVenue.id,
    startsAt: new Date(now - 10 * DAY_MS),
    status: 'played' as const,
  }
  const weekendUpcoming = {
    id: uuid(),
    standingGameId: weekendStanding.id,
    circleId: weekendCircle.id,
    venueId: wandsworthVenue.id,
    startsAt: new Date(now + 3 * DAY_MS),
    status: 'upcoming' as const,
  }
  await db
    .insert(sessions)
    .values([tuesdayPlayed1, tuesdayPlayed2, tuesdayUpcoming, weekendPlayed1, weekendUpcoming])

  // ---- RSVPs (upcoming sessions) ----
  await db.insert(rsvps).values([
    { sessionId: tuesdayUpcoming.id, userId: alex.id, status: 'in' },
    { sessionId: tuesdayUpcoming.id, userId: priya.id, status: 'in' },
    { sessionId: tuesdayUpcoming.id, userId: jordan.id, status: 'in' },
    { sessionId: tuesdayUpcoming.id, userId: kwame.id, status: 'in' },
    { sessionId: tuesdayUpcoming.id, userId: sofia.id, status: 'reserve', position: 1 },
    { sessionId: tuesdayUpcoming.id, userId: tom.id, status: 'out' },

    { sessionId: weekendUpcoming.id, userId: nadia.id, status: 'in' },
    { sessionId: weekendUpcoming.id, userId: freya.id, status: 'in' },
    { sessionId: weekendUpcoming.id, userId: owen.id, status: 'in' },
    { sessionId: weekendUpcoming.id, userId: jordan.id, status: 'in' },
    { sessionId: weekendUpcoming.id, userId: marcus.id, status: 'reserve', position: 1 },
  ])

  // ---- Match 1 (tuesdayPlayed1): the DESIGN.md worked example ----
  // Team A: Alex 4.10 + Priya 3.70 -> avg 3.90. Team B: Jordan 3.95 + Kwame 3.65 -> avg 3.80.
  // P(A) = 0.613, margin multiplier = 1.13 (12 of 19 games).
  const match1Id = uuid()
  const match1ConfirmedAt = new Date(tuesdayPlayed1.startsAt.getTime() + 90 * 60 * 1000)
  await db.insert(matches).values({
    id: match1Id,
    sessionId: tuesdayPlayed1.id,
    teamAPlayer1Id: alex.id,
    teamAPlayer2Id: priya.id,
    teamBPlayer1Id: jordan.id,
    teamBPlayer2Id: kwame.id,
    score: [
      { a: 6, b: 3 },
      { a: 6, b: 4 },
    ],
    status: 'verified',
    playedAt: tuesdayPlayed1.startsAt,
  })
  await db.insert(matchConfirmations).values([
    { matchId: match1Id, team: 'A', confirmedByUserId: alex.id, confirmedAt: match1ConfirmedAt },
    { matchId: match1Id, team: 'B', confirmedByUserId: jordan.id, confirmedAt: match1ConfirmedAt },
  ])
  await db.insert(ratingEvents).values([
    {
      userId: alex.id,
      matchId: match1Id,
      delta: 0.017,
      ratingBefore: 4.083,
      ratingAfter: 4.1,
      confidenceBefore: 0.64,
      confidenceAfter: 0.72,
      factors: {
        expectedWin: 0.613,
        marginMultiplier: 1.13,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [jordan.id, kwame.id],
        isFirstMeeting: true,
      },
      explanation: '+0.02 · beat a slightly stronger pair, comfortable margin · vs Jordan, Kwame (first meeting — full weight)',
      createdAt: match1ConfirmedAt,
    },
    {
      userId: priya.id,
      matchId: match1Id,
      delta: 0.017,
      ratingBefore: 3.683,
      ratingAfter: 3.7,
      confidenceBefore: 0.56,
      confidenceAfter: 0.64,
      factors: {
        expectedWin: 0.613,
        marginMultiplier: 1.13,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [jordan.id, kwame.id],
        isFirstMeeting: true,
      },
      explanation: '+0.02 · beat a slightly stronger pair, comfortable margin · vs Jordan, Kwame (first meeting — full weight)',
      createdAt: match1ConfirmedAt,
    },
    {
      userId: jordan.id,
      matchId: match1Id,
      delta: -0.02,
      ratingBefore: 3.97,
      ratingAfter: 3.95,
      confidenceBefore: 0.72,
      confidenceAfter: 0.8,
      factors: {
        expectedWin: 0.387,
        marginMultiplier: 1.13,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [alex.id, priya.id],
        isFirstMeeting: true,
      },
      explanation: '-0.02 · lost to a slightly weaker pair, close margin · vs Alex, Priya (first meeting — full weight)',
      createdAt: match1ConfirmedAt,
    },
    {
      userId: kwame.id,
      matchId: match1Id,
      delta: -0.02,
      ratingBefore: 3.67,
      ratingAfter: 3.65,
      confidenceBefore: 0.48,
      confidenceAfter: 0.56,
      factors: {
        expectedWin: 0.387,
        marginMultiplier: 1.13,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [alex.id, priya.id],
        isFirstMeeting: true,
      },
      explanation: '-0.02 · lost to a slightly weaker pair, close margin · vs Alex, Priya (first meeting — full weight)',
      createdAt: match1ConfirmedAt,
    },
  ])

  // ---- Match 2 (tuesdayPlayed2): Tom's Placement Trio completes; Lucia's first placement match ----
  const match2Id = uuid()
  const match2ConfirmedAt = new Date(tuesdayPlayed2.startsAt.getTime() + 95 * 60 * 1000)
  await db.insert(matches).values({
    id: match2Id,
    sessionId: tuesdayPlayed2.id,
    teamAPlayer1Id: sofia.id,
    teamAPlayer2Id: ben.id,
    teamBPlayer1Id: tom.id,
    teamBPlayer2Id: lucia.id,
    score: [
      { a: 4, b: 6 },
      { a: 6, b: 3 },
      { a: 4, b: 6 },
    ],
    status: 'verified',
    playedAt: tuesdayPlayed2.startsAt,
  })
  await db.insert(matchConfirmations).values([
    { matchId: match2Id, team: 'A', confirmedByUserId: sofia.id, confirmedAt: match2ConfirmedAt },
    { matchId: match2Id, team: 'B', confirmedByUserId: tom.id, confirmedAt: match2ConfirmedAt },
  ])
  await db.insert(ratingEvents).values([
    {
      userId: sofia.id,
      matchId: match2Id,
      delta: -0.015,
      ratingBefore: 3.415,
      ratingAfter: 3.4,
      confidenceBefore: 0.44,
      confidenceAfter: 0.48,
      factors: {
        expectedWin: 0.58,
        marginMultiplier: 1.02,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [tom.id, lucia.id],
        isFirstMeeting: true,
      },
      explanation: '-0.02 · lost a close three-setter · vs Tom, Lucia (first meeting — full weight)',
      createdAt: match2ConfirmedAt,
    },
    {
      userId: ben.id,
      matchId: match2Id,
      delta: -0.02,
      ratingBefore: 2.92,
      ratingAfter: 2.9,
      confidenceBefore: 0.28,
      confidenceAfter: 0.32,
      factors: {
        expectedWin: 0.58,
        marginMultiplier: 1.02,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [tom.id, lucia.id],
        isFirstMeeting: true,
      },
      explanation: '-0.02 · lost a close three-setter · vs Tom, Lucia (first meeting — full weight)',
      createdAt: match2ConfirmedAt,
    },
    {
      // Placement Trio complete: this is Tom's 3rd verified match, so his
      // Glass number (3.25) goes live — see the `users.rating` update below.
      userId: tom.id,
      matchId: match2Id,
      delta: 0.15,
      ratingBefore: null,
      ratingAfter: 3.25,
      confidenceBefore: 0.16,
      confidenceAfter: 0.24,
      factors: {
        expectedWin: 0.42,
        marginMultiplier: 1.02,
        echoDampingMultiplier: 1,
        kFactor: 0.12,
        opponentUserIds: [sofia.id, ben.id],
        isFirstMeeting: true,
      },
      explanation: 'Placement Trio complete — your Glass number is live: 3.25',
      createdAt: match2ConfirmedAt,
    },
    {
      // Lucia's first placement match — still Unrated in `users.rating` until
      // her Placement Trio (2 more matches) resolves; the Ledger already
      // tracks a real internal estimate.
      userId: lucia.id,
      matchId: match2Id,
      delta: -0.1,
      ratingBefore: null,
      ratingAfter: 3.3,
      confidenceBefore: 0,
      confidenceAfter: 0.08,
      factors: {
        expectedWin: 0.42,
        marginMultiplier: 1.02,
        echoDampingMultiplier: 1,
        kFactor: 0.12,
        opponentUserIds: [sofia.id, ben.id],
        isFirstMeeting: true,
      },
      explanation: 'Placement match 1 of 3 — your Glass number stays hidden until the Trio completes',
      createdAt: match2ConfirmedAt,
    },
  ])

  // ---- Match 3 (weekendPlayed1): Marcus's first placement match ----
  const match3Id = uuid()
  const match3ConfirmedAt = new Date(weekendPlayed1.startsAt.getTime() + 90 * 60 * 1000)
  await db.insert(matches).values({
    id: match3Id,
    sessionId: weekendPlayed1.id,
    teamAPlayer1Id: nadia.id,
    teamAPlayer2Id: freya.id,
    teamBPlayer1Id: owen.id,
    teamBPlayer2Id: marcus.id,
    score: [
      { a: 6, b: 2 },
      { a: 6, b: 1 },
    ],
    status: 'verified',
    playedAt: weekendPlayed1.startsAt,
  })
  await db.insert(matchConfirmations).values([
    { matchId: match3Id, team: 'A', confirmedByUserId: nadia.id, confirmedAt: match3ConfirmedAt },
    { matchId: match3Id, team: 'B', confirmedByUserId: owen.id, confirmedAt: match3ConfirmedAt },
  ])
  await db.insert(ratingEvents).values([
    {
      userId: nadia.id,
      matchId: match3Id,
      delta: 0.01,
      ratingBefore: 4.34,
      ratingAfter: 4.35,
      confidenceBefore: 0.86,
      confidenceAfter: 0.88,
      factors: {
        expectedWin: 0.82,
        marginMultiplier: 1.24,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [owen.id, marcus.id],
        isFirstMeeting: true,
      },
      explanation: '+0.01 · beat a weaker pair, dominant margin · vs Owen, Marcus (first meeting — full weight)',
      createdAt: match3ConfirmedAt,
    },
    {
      userId: freya.id,
      matchId: match3Id,
      delta: 0.015,
      ratingBefore: 3.785,
      ratingAfter: 3.8,
      confidenceBefore: 0.64,
      confidenceAfter: 0.68,
      factors: {
        expectedWin: 0.82,
        marginMultiplier: 1.24,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [owen.id, marcus.id],
        isFirstMeeting: true,
      },
      explanation: '+0.02 · beat a weaker pair, dominant margin · vs Owen, Marcus (first meeting — full weight)',
      createdAt: match3ConfirmedAt,
    },
    {
      userId: owen.id,
      matchId: match3Id,
      delta: -0.025,
      ratingBefore: 3.125,
      ratingAfter: 3.1,
      confidenceBefore: 0.36,
      confidenceAfter: 0.4,
      factors: {
        expectedWin: 0.18,
        marginMultiplier: 1.24,
        echoDampingMultiplier: 1,
        kFactor: 0.04,
        opponentUserIds: [nadia.id, freya.id],
        isFirstMeeting: true,
      },
      explanation: '-0.03 · lost to a stronger pair, heavy margin · vs Nadia, Freya (first meeting — full weight)',
      createdAt: match3ConfirmedAt,
    },
    {
      userId: marcus.id,
      matchId: match3Id,
      delta: -0.2,
      ratingBefore: null,
      ratingAfter: 3.0,
      confidenceBefore: 0,
      confidenceAfter: 0.08,
      factors: {
        expectedWin: 0.18,
        marginMultiplier: 1.24,
        echoDampingMultiplier: 1,
        kFactor: 0.12,
        opponentUserIds: [nadia.id, freya.id],
        isFirstMeeting: true,
      },
      explanation: 'Placement match 1 of 3 — your Glass number stays hidden until the Trio completes',
      createdAt: match3ConfirmedAt,
    },
  ])

  // ---- The Tab (GBP throughout — UK-only launch) ----
  const tuesdayTabId = uuid()
  const weekendTabId = uuid()
  await db.insert(tabs).values([
    { id: tuesdayTabId, circleId: tuesdayCircle.id },
    { id: weekendTabId, circleId: weekendCircle.id },
  ])
  await db.insert(tabEntries).values([
    {
      tabId: tuesdayTabId,
      sessionId: tuesdayPlayed1.id,
      payerUserId: alex.id,
      debtorUserId: priya.id,
      amountMinor: 800,
      currency: 'GBP',
      status: 'settled',
      settledConfirmedBy: alex.id,
      settledAt: new Date(match1ConfirmedAt.getTime() + 60 * 60 * 1000),
    },
    {
      tabId: tuesdayTabId,
      sessionId: tuesdayPlayed1.id,
      payerUserId: alex.id,
      debtorUserId: jordan.id,
      amountMinor: 800,
      currency: 'GBP',
      status: 'settled',
      settledConfirmedBy: alex.id,
      settledAt: new Date(match1ConfirmedAt.getTime() + 2 * 60 * 60 * 1000),
    },
    {
      tabId: tuesdayTabId,
      sessionId: tuesdayPlayed1.id,
      payerUserId: alex.id,
      debtorUserId: kwame.id,
      amountMinor: 800,
      currency: 'GBP',
      status: 'nudged',
      nudgedAt: new Date(now - 2 * DAY_MS),
    },
    {
      tabId: tuesdayTabId,
      sessionId: tuesdayPlayed2.id,
      payerUserId: sofia.id,
      debtorUserId: ben.id,
      amountMinor: 750,
      currency: 'GBP',
      status: 'open',
    },
    {
      tabId: tuesdayTabId,
      sessionId: tuesdayPlayed2.id,
      payerUserId: sofia.id,
      debtorUserId: lucia.id,
      amountMinor: 750,
      currency: 'GBP',
      status: 'open',
    },
    {
      tabId: weekendTabId,
      sessionId: weekendPlayed1.id,
      payerUserId: nadia.id,
      debtorUserId: owen.id,
      amountMinor: 900,
      currency: 'GBP',
      status: 'settled',
      settledConfirmedBy: nadia.id,
      settledAt: new Date(now - 9 * DAY_MS),
    },
    {
      tabId: weekendTabId,
      sessionId: weekendPlayed1.id,
      payerUserId: nadia.id,
      debtorUserId: marcus.id,
      amountMinor: 900,
      currency: 'GBP',
      status: 'open',
    },
  ])

  // ---- Notifications (a slice of the product's heartbeat) ----
  await db.insert(notifications).values([
    {
      userId: sofia.id,
      type: 'fourth_call',
      payload: { sessionId: tuesdayUpcoming.id, level: 1 },
      createdAt: new Date(now - 1 * DAY_MS),
    },
    {
      userId: kwame.id,
      type: 'tab_nudge',
      payload: { tabEntryAmountMinor: 800, currency: 'GBP', debtorUserId: kwame.id },
      createdAt: new Date(now - 2 * DAY_MS),
    },
    {
      userId: tom.id,
      type: 'placement_complete',
      payload: { rating: 3.25 },
      readAt: new Date(match2ConfirmedAt.getTime() + 10 * 60 * 1000),
      createdAt: match2ConfirmedAt,
    },
  ])
}

async function main() {
  const { db, close } = createClient()
  await seed(db)
  console.log('[@cuatro/db] seed complete')
  close()
}

// Only run automatically when executed directly (`npm run seed`), not when
// imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
