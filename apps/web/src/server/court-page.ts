/**
 * THE ATLAS — the court page / venue sheet read model (T4).
 *
 * `getCourtPageView(db, venueId)` composes ONE public, viewer-independent view
 * of a venue: its community-filled facts, who calls it home, the Circles that
 * play there, and its open games. It is the single source behind both the
 * shareable court page (app/courts/[slug]) and the venue sheet the Discover map
 * opens on a marker tap.
 *
 * PRIVACY (no new rules — this composes the shipped contract):
 *  - Private Circles (openDoor=false AND boardEnabled=false) are NEVER selected,
 *    not in the "who plays here" list and not in the open-games gate. The
 *    exclusion is at the QUERY level (a private Circle's rows never leave the DB
 *    here), mirroring The Board / Open Door's `openDoor OR boardEnabled` gate.
 *  - Guests are excluded from memberCount and from homeToCount (findable,
 *    non-guest users only) — the same rule discovery queries use everywhere.
 *  - No coordinates, no member rosters, no viewer-relative distance: the page is
 *    public and identical logged-out or in. Distances are viewer-relative and so
 *    are deliberately omitted at v1 (the map preview stays "postcode-rough").
 *
 * The claim/ask affordance is NOT reimplemented here: open games carry only the
 * public facts a Board card shows, and the UI links to /games/[sessionId] where
 * the real, viewer-aware claim/ask lives.
 */
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroDb,
} from "@cuatro/db";
import { bookingPlatform } from "@/lib/booking";
import { extractUkPostcode } from "@/server/geocode";
import { venueAreaHint } from "@/server/venues";
import { DEFAULT_SESSION_SLOTS, DEFAULT_RSVP_WINDOW_DAYS } from "@/server/games-service";
import { formatTime, formatWeekdayDay } from "@/lib/time";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"] as const;

/** A Circle that plays at this venue, as "WHO PLAYS HERE" shows it. Aggregate, public facts only. */
export interface CourtCircle {
  circleId: string;
  name: string;
  /** Organiser's emblem; null falls back to a two-letter monogram in the UI. */
  emblem: string | null;
  colour: string | null;
  /** "open" = knockable; "invite_only" = join by link, games still take asks. Private never appears. */
  tier: "open" | "invite_only";
  /** Non-guest members. */
  memberCount: number;
  /** "Sundays" / "Tuesdays 20:00" — the soonest active Standing Game cadence, or null. */
  cadence: string | null;
}

/** An open-slot upcoming game at this venue, ready to link to its session page. */
export interface CourtOpenGame {
  sessionId: string;
  circleName: string;
  /** "Sun 12 · 10:00", formatted in the session's timezone (world-ready). */
  whenLabel: string;
  /** "hosted by Leo's Lot · Glass 4.30–4.80" — the same warm line The Board shows. */
  line: string;
  slotsOpen: number;
}

/** The booked-on signpost tile for a venue whose games point at a partner. */
export interface CourtBooking {
  platform: string;
  label: string;
  /** Two-letter tile (never a logo), reused from lib/booking. */
  tile: string;
}

/** The full public view behind the court page and the venue sheet. */
export interface CourtView {
  venueId: string;
  name: string;
  slug: string;
  /** "OUTDOOR · 4 COURTS · E9 7DE" | "E9 5EN · facts wanted" | "facts wanted". Facts in mono. */
  factsLine: string;
  homeToCount: number;
  /** "home court to 14 players" / "home court to 1 player" / "home court to no one yet". */
  homeLine: string;
  circles: CourtCircle[];
  openGames: CourtOpenGame[];
  /** Null when no open game here points at a booking partner (no tile). */
  booking: CourtBooking | null;
}

/**
 * The venue's mono facts line, matching the DC exactly:
 *   indoor/outdoor (upper) · N COURTS · postcode
 * A court with neither an environment nor a court count reads "<postcode> ·
 * facts wanted" (or just "facts wanted" with no postcode) — the Atlas earns
 * its facts, it never blocks a court for lacking them.
 */
export function venueFactsLine(v: { indoorOutdoor: string | null; courtCount: number | null; address: string | null }): string {
  const area = extractUkPostcode(v.address) ?? venueAreaHint(v.address);
  const parts: string[] = [];
  if (v.indoorOutdoor) parts.push(v.indoorOutdoor.toUpperCase());
  if (v.courtCount != null) parts.push(`${v.courtCount} COURT${v.courtCount === 1 ? "" : "S"}`);
  if (parts.length === 0) return area ? `${area} · facts wanted` : "facts wanted";
  if (area) parts.push(area);
  return parts.join(" · ");
}

/** "home court to N players" (with 1/none special cases), matching the DC copy. */
export function homeCourtLine(count: number): string {
  if (count > 1) return `home court to ${count} players`;
  if (count === 1) return "home court to 1 player";
  return "home court to no one yet";
}

/** "who's already in" as one warm line — the same Glass summary The Board uses. */
function levelLineFor(ratings: (number | null)[]): string {
  const rated = ratings.filter((r): r is number => r != null);
  if (rated.length === 0) return "levels still forming";
  const min = Math.min(...rated);
  const max = Math.max(...rated);
  const range = min === max ? `Glass ${min.toFixed(2)}` : `Glass ${min.toFixed(2)}–${max.toFixed(2)}`;
  return rated.length < ratings.length ? `${range} · mixed` : range;
}

/**
 * The public court view for a venue, or null if the venue doesn't exist. See
 * the file header for the privacy contract this composes.
 */
export async function getCourtPageView(db: CuatroDb, venueId: string, now: Date = new Date()): Promise<CourtView | null> {
  const [venue] = await db.select().from(venues).where(eq(venues.id, venueId)).limit(1);
  if (!venue) return null;

  // A circle is VISIBLE (never private) when its door is open OR it posts to
  // The Board. Private circles fall through this gate and never leave the DB.
  const isVisible = or(eq(circles.openDoor, true), eq(circles.boardEnabled, true));

  // Circles that play here: an explicit home venue, a Standing Game here, or a
  // session here — each restricted to visible circles at the query level.
  const homeCircleRows = await db
    .select({ id: circles.id })
    .from(circles)
    .where(and(eq(circles.homeVenueId, venueId), isVisible));
  const sgCircleRows = await db
    .select({ id: circles.id })
    .from(circles)
    .innerJoin(standingGames, eq(standingGames.circleId, circles.id))
    .where(and(eq(standingGames.venueId, venueId), isVisible));
  const sessCircleRows = await db
    .select({ id: circles.id })
    .from(circles)
    .innerJoin(sessions, eq(sessions.circleId, circles.id))
    .where(and(eq(sessions.venueId, venueId), isVisible));

  const circleIds = [...new Set([...homeCircleRows, ...sgCircleRows, ...sessCircleRows].map((r) => r.id))];

  const circleCards = circleIds.length > 0 ? await buildCircleCards(db, circleIds) : [];
  const openGames = await buildOpenGames(db, venueId, now);
  const homeToCount = await countHomeCourt(db, venueId);

  // Booked-on tile: the first booking partner any open game here points at.
  const bookingId = openGames.find((g) => g.bookingPlatform)?.bookingPlatform ?? null;
  const platform = bookingPlatform(bookingId);
  const booking: CourtBooking | null = platform
    ? { platform: platform.id, label: platform.label, tile: platform.tile }
    : null;

  return {
    venueId: venue.id,
    name: venue.name,
    // slug is filled on every creation path + backfilled by migration 0005;
    // fall back to the id so a raw-inserted row never renders a broken URL.
    slug: venue.slug ?? venue.id,
    factsLine: venueFactsLine(venue),
    homeToCount,
    homeLine: homeCourtLine(homeToCount),
    circles: circleCards,
    openGames: openGames.map(({ bookingPlatform: _b, ...g }) => g),
    booking,
  };
}

/** Findable, non-guest users who call this venue their home court. */
async function countHomeCourt(db: CuatroDb, venueId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(users)
    .where(and(eq(users.homeVenueId, venueId), eq(users.isGuest, false), eq(users.findable, true)));
  return row?.n ?? 0;
}

/** Circle cards (name/emblem/colour/tier/memberCount/cadence), ordered open-first then alphabetical. */
async function buildCircleCards(db: CuatroDb, circleIds: string[]): Promise<CourtCircle[]> {
  const baseRows = await db
    .select({
      id: circles.id,
      name: circles.name,
      emblem: circles.emblem,
      colour: circles.colour,
      openDoor: circles.openDoor,
    })
    .from(circles)
    .where(inArray(circles.id, circleIds));

  // Non-guest member counts, one grouped query.
  const memberRows = await db
    .select({ circleId: circleMembers.circleId, n: sql<number>`cast(count(*) as int)` })
    .from(circleMembers)
    .innerJoin(users, eq(users.id, circleMembers.userId))
    .where(and(inArray(circleMembers.circleId, circleIds), eq(users.isGuest, false)))
    .groupBy(circleMembers.circleId);
  const memberCountBy = new Map(memberRows.map((r) => [r.circleId, Number(r.n)]));

  // Cadence: the soonest-weekday active Standing Game per circle.
  const sgRows = await db
    .select({ circleId: standingGames.circleId, weekday: standingGames.weekday, startTime: standingGames.startTime })
    .from(standingGames)
    .where(and(inArray(standingGames.circleId, circleIds), eq(standingGames.active, true)));
  const cadenceBy = new Map<string, { weekday: number; startTime: string }>();
  for (const row of sgRows) {
    const cur = cadenceBy.get(row.circleId);
    if (!cur || row.weekday < cur.weekday) cadenceBy.set(row.circleId, { weekday: row.weekday, startTime: row.startTime });
  }

  const cards: CourtCircle[] = baseRows.map((c) => {
    const cad = cadenceBy.get(c.id);
    return {
      circleId: c.id,
      name: c.name,
      emblem: c.emblem,
      colour: c.colour,
      tier: c.openDoor ? "open" : "invite_only",
      memberCount: memberCountBy.get(c.id) ?? 0,
      cadence: cad ? WEEKDAY_PLURAL[cad.weekday] : null,
    };
  });

  const tierRank = (t: CourtCircle["tier"]) => (t === "open" ? 0 : 1);
  cards.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name));
  return cards;
}

type OpenGameRow = CourtOpenGame & { startsAt: number; bookingPlatform: string | null };

/**
 * Upcoming open-slot games at this venue from visible (non-private) circles,
 * RSVP window open, soonest first. Composed from the same facts a Board card
 * carries; the claim/ask itself lives on the session page (never reimplemented).
 */
async function buildOpenGames(db: CuatroDb, venueId: string, now: Date): Promise<OpenGameRow[]> {
  const isVisible = or(eq(circles.openDoor, true), eq(circles.boardEnabled, true));

  const rows = await db
    .select({
      sessionId: sessions.id,
      circleName: circles.name,
      startsAt: sessions.startsAt,
      standingGameId: sessions.standingGameId,
      sessionBooking: sessions.bookingPlatform,
      venueTimezone: venues.timezone,
      circleTimezone: circles.timezone,
      slots: standingGames.slots,
      rsvpWindowDays: standingGames.rsvpWindowDays,
      sgBooking: standingGames.bookingPlatform,
    })
    .from(sessions)
    .innerJoin(circles, eq(circles.id, sessions.circleId))
    .innerJoin(venues, eq(venues.id, sessions.venueId))
    .leftJoin(standingGames, eq(standingGames.id, sessions.standingGameId))
    .where(
      and(
        eq(sessions.venueId, venueId),
        eq(sessions.status, "upcoming"),
        gt(sessions.startsAt, now.getTime()),
        isVisible,
      ),
    );
  if (rows.length === 0) return [];

  // Confirmed counts + rated ratings per candidate session, two batched queries.
  const sessionIds = rows.map((r) => r.sessionId);
  const confirmedRows = await db
    .select({ sessionId: rsvps.sessionId, rating: users.rating })
    .from(rsvps)
    .innerJoin(users, eq(users.id, rsvps.userId))
    .where(and(inArray(rsvps.sessionId, sessionIds), eq(rsvps.status, "in")));
  const ratingsBy = new Map<string, (number | null)[]>();
  for (const r of confirmedRows) {
    const list = ratingsBy.get(r.sessionId) ?? [];
    list.push(r.rating);
    ratingsBy.set(r.sessionId, list);
  }

  const out: OpenGameRow[] = [];
  for (const row of rows) {
    const windowOpensAt = row.startsAt - (row.rsvpWindowDays ?? DEFAULT_RSVP_WINDOW_DAYS) * DAY_MS;
    if (now.getTime() < windowOpensAt) continue; // RSVP window not open yet

    const ratings = ratingsBy.get(row.sessionId) ?? [];
    const slots = row.slots ?? DEFAULT_SESSION_SLOTS;
    const slotsOpen = slots - ratings.length;
    if (slotsOpen <= 0) continue; // full

    const tz = row.venueTimezone ?? row.circleTimezone;
    const startsAt = row.startsAt;
    out.push({
      sessionId: row.sessionId,
      circleName: row.circleName,
      whenLabel: `${formatWeekdayDay(startsAt, tz)} · ${formatTime(startsAt, tz)}`,
      line: `hosted by ${row.circleName} · ${levelLineFor(ratings)}`,
      slotsOpen,
      startsAt,
      // A session's own booking wins; else it inherits the Standing Game's.
      bookingPlatform: row.sessionBooking ?? row.sgBooking ?? null,
    });
  }

  out.sort((a, b) => a.startsAt - b.startsAt);
  return out;
}
