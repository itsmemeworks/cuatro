/**
 * Circles server logic, backed by @cuatro/db (drizzle + better-sqlite3).
 * Every read/write enforces membership; `updateCircleSettings` additionally
 * requires the organiser role. This is the one place the rest of the app
 * talks to for Circles + chat persistence — API routes and server actions
 * call through here, never through @cuatro/db directly.
 *
 * Differs from ./../lib/auth-store.ts's `createXStore(dbPath)` shape on
 * purpose: `createCirclesStore` takes an already-open `CuatroDb` (not a
 * path) so tests can open one :memory: client, seed users/circles directly
 * against it, and hand the *same* handle to the store — two separate
 * `:memory:` connections are two separate empty databases, so a path-based
 * constructor would leave test fixtures invisible to the store under test.
 * `getCirclesStore()` is still the process-wide singleton the app uses.
 *
 * Chat delivery: postMessage() broadcasts a minimal-signal realtime event
 * (see ../lib/realtime) on the circle's `cuatro:circle:{id}` channel after
 * the write commits — never the message body itself. Clients subscribed via
 * useCircleLive backfill through GET .../messages?after= (see
 * app/api/circles/[id]/messages/route.ts) to get the actual content. This
 * replaced an in-process listener map feeding an SSE stream, which only
 * worked because the app ran as a single Fly machine — the realtime bus
 * removes that assumption, since Supabase Realtime (not this process) fans
 * the broadcast out to every connected client regardless of which app
 * instance handled the write.
 */
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { createClient, circleMembers, circleMessages, circles, users, venues } from "@cuatro/db";
import type { CuatroDb, Circle } from "@cuatro/db";
import { HEADER_KEYS, isHeaderKey } from "@/lib/circle-headers";
import { emitCircleEvent } from "@/lib/realtime/broadcast";

const MAX_INVITE_CODE_ATTEMPTS = 8;
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MESSAGE_LIMIT = 200;

// Unambiguous, URL-safe alphabet: no 0/O, 1/I/L — the characters people most
// often misread off a screenshot or a shouted-across-the-court invite code.
const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;

/** A Circle name stays short enough to render on one line in a header/row. */
export const MAX_CIRCLE_NAME_LENGTH = 40;

/**
 * A Circle's optional roster cap. `null` means uncapped. When set it is bound
 * to [MIN_MAX_MEMBERS, MAX_MAX_MEMBERS]: a Circle is a padel four's home, so a
 * cap below one full court's worth (4) is nonsensical, and 64 is a generous
 * ceiling that keeps a "Circle" a group rather than a directory.
 */
export const MIN_MAX_MEMBERS = 4;
export const MAX_MAX_MEMBERS = 64;

export const CIRCLE_COLOUR_PRESETS = [
  "#1F6FEB",
  "#D9822B",
  "#7DE0C8",
  "#F2755C",
  "#8B5CF6",
  "#E8B954",
] as const;

export class NotMemberError extends Error {
  constructor() {
    super("not a member of this circle");
    this.name = "NotMemberError";
  }
}

export class NotOrganiserError extends Error {
  constructor() {
    super("only organisers can do this");
    this.name = "NotOrganiserError";
  }
}

export class InvalidCircleNameError extends Error {
  constructor() {
    super(`circle name must be 1–${MAX_CIRCLE_NAME_LENGTH} characters`);
    this.name = "InvalidCircleNameError";
  }
}

export class InvalidEmblemError extends Error {
  constructor() {
    super("emblem must be a single emoji or mark");
    this.name = "InvalidEmblemError";
  }
}

export class InvalidColourError extends Error {
  constructor() {
    super("colour must be a #rrggbb hex value");
    this.name = "InvalidColourError";
  }
}

export class EmptyMessageError extends Error {
  constructor() {
    super("message body is empty");
    this.name = "EmptyMessageError";
  }
}

export class MessageTooLongError extends Error {
  constructor() {
    super(`message body exceeds ${MAX_MESSAGE_LENGTH} characters`);
    this.name = "MessageTooLongError";
  }
}

/**
 * Thrown by insertCircleMembership when a capped Circle is already at its
 * limit. Raised from INSIDE the membership-insert (and so inside whatever
 * transaction wraps it), so an over-cap accept/join/guest-join rolls back
 * whole. Callers map it to the `circle_full` error code.
 */
export class CircleFullError extends Error {
  constructor() {
    super("circle is at its member limit");
    this.name = "CircleFullError";
  }
}

/** maxMembers is out of range, or an update would set it below the current member count. */
export class InvalidMaxMembersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMaxMembersError";
  }
}

/** headerImage is not one of the curated collection keys. */
export class InvalidHeaderImageError extends Error {
  constructor() {
    super("header image must be one of the curated collection keys");
    this.name = "InvalidHeaderImageError";
  }
}

/** homeVenueId does not reference an existing venue. */
export class InvalidHomeVenueError extends Error {
  constructor() {
    super("home venue must be an existing venue");
    this.name = "InvalidHomeVenueError";
  }
}

export interface CircleSummary {
  id: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  /** Curated header collection KEY (e.g. "court-03"), or null → use the deterministic default (headerFor). Never a URL. */
  headerImage: string | null;
  countryCode: string;
  timezone: string;
  inviteCode: string;
  createdBy: string;
  createdAt: Date;
  memberCount: number;
  /** Roster cap; null = uncapped. */
  maxMembers: number | null;
  myRole: "organiser" | "member";
}

export interface CircleMemberView {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "organiser" | "member";
  joinedAt: Date;
  rating: number | null;
  confidence: number;
  /** Show-up rate placeholder (showUpCount / rsvpInCount); null = no RSVP history yet. */
  reliability: number | null;
  /** Verified matches played so far — drives the Placement Trio progress dots for an unrated (rating === null) member. Capped display-side at PLACEMENT_TRIO_SIZE (3); this is the raw count. */
  verifiedMatchCount: number;
}

export interface CircleDetail {
  id: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  countryCode: string;
  timezone: string;
  inviteCode: string;
  createdBy: string;
  /** Open Door: does this Circle accept knocks from players who found it? */
  openDoor: boolean;
  /** The Board: does this Circle surface its open games (and, with the door shut, list as "invite only") near players? */
  boardEnabled: boolean;
  /** One warm directory sentence; null until an organiser writes it. */
  vibeLine: string | null;
  /** Curated header collection KEY (e.g. "court-03"), or null → deterministic default (headerFor). Never a URL. */
  headerImage: string | null;
  /** Explicit home venue id, or null (anchor then derives from most-used pinned venue). */
  homeVenueId: string | null;
  /** Resolved home venue name/address when a home venue is set, else null (cheap join). */
  homeVenueName: string | null;
  homeVenueAddress: string | null;
  /** Roster cap; null = uncapped. */
  maxMembers: number | null;
  /** Non-guest + guest members alike — the full roster size (matches members.length). */
  memberCount: number;
  myRole: "organiser" | "member";
  members: CircleMemberView[];
}

export interface CircleMessageView {
  id: string;
  circleId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: Date;
}

export interface CreateCircleInput {
  name: string;
  emblem?: string | null;
  colour?: string | null;
  /** Curated header key; validated against HEADER_KEYS. Omit/null → deterministic default at render time. */
  headerImage?: string | null;
  /** Explicit home venue id; must exist in venues. */
  homeVenueId?: string | null;
  /** Roster cap (MIN_MAX_MEMBERS..MAX_MAX_MEMBERS) or null for uncapped. */
  maxMembers?: number | null;
  countryCode?: string;
  timezone?: string;
  creatorUserId: string;
}

export interface UpdateCircleSettingsInput {
  name?: string;
  emblem?: string | null;
  colour?: string | null;
  timezone?: string;
  /** Open Door toggle — whether the Circle accepts knocks. */
  openDoor?: boolean;
  /** The Board toggle — whether the Circle's open games surface near players (and it lists as "invite only" when the door is shut). */
  boardEnabled?: boolean;
  /** One warm directory sentence; trimmed, and an empty string clears it back to null. */
  vibeLine?: string | null;
  /** Curated header key; validated against HEADER_KEYS. `null` resets to the deterministic default. */
  headerImage?: string | null;
  /** Explicit home venue id; must exist. `null` clears it (anchor falls back to derived). */
  homeVenueId?: string | null;
  /** Roster cap; validated to MIN_MAX_MEMBERS..MAX_MAX_MEMBERS and not below the current member count. `null` uncaps. */
  maxMembers?: number | null;
}

/** One warm directory sentence has a hard ceiling so a card stays a card. */
export const MAX_VIBE_LINE_LENGTH = 120;

export interface JoinCircleResult {
  circleId: string;
  circleName: string;
  alreadyMember: boolean;
  /** The Circle is capped and full — no membership was added. `alreadyMember` is false when this is true. */
  full: boolean;
}

export interface CirclesStore {
  createCircle(input: CreateCircleInput): Promise<CircleSummary>;
  getCircleByInviteCode(
    inviteCode: string,
  ): Promise<{
    id: string;
    name: string;
    emblem: string | null;
    colour: string | null;
    headerImage: string | null;
    memberCount: number;
    maxMembers: number | null;
  } | null>;
  joinCircle(input: { inviteCode: string; userId: string }): Promise<JoinCircleResult | null>;
  listCirclesForUser(userId: string): Promise<CircleSummary[]>;
  getCircleDetail(circleId: string, requestingUserId: string): Promise<CircleDetail | null>;
  updateCircleSettings(
    circleId: string,
    requestingUserId: string,
    updates: UpdateCircleSettingsInput,
  ): Promise<void>;
  postMessage(input: { circleId: string; userId: string; body: string }): Promise<CircleMessageView>;
  listMessages(
    circleId: string,
    requestingUserId: string,
    opts?: { after?: Date; limit?: number },
  ): Promise<CircleMessageView[]>;
}

function defaultGenerateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * True for a Postgres unique-constraint violation, however the driver wraps it.
 * Shared by the knock/guest insert paths that pre-check then rely on a partial
 * unique index as the real race guard (open-door, discovery, guest).
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Postgres unique_violation is SQLSTATE 23505. postgres-js surfaces `.code`
  // directly; drizzle (and PGlite) wrap the driver error, exposing it on
  // `.cause.code`. Fall back to a message match for either wrapping.
  const code = (err as { code?: string }).code ?? (err.cause as { code?: string } | undefined)?.code;
  if (code === "23505") return true;
  const causeMessage = (err.cause as { message?: string } | undefined)?.message ?? "";
  return /duplicate key value|unique constraint/i.test(`${err.message} ${causeMessage}`);
}

/**
 * Grapheme count via Intl.Segmenter (Node 24 / modern browsers). A single
 * user-perceived emoji — including a flag or a ZWJ family sequence made of
 * several code points — counts as one, so the emblem rule ("one emoji is
 * plenty") holds for composed emoji, not just BMP ones.
 */
function graphemeCount(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
}

/** Trim + bound a Circle name; throws InvalidCircleNameError when empty or too long. */
function validateCircleName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new InvalidCircleNameError();
  if (graphemeCount(trimmed) > MAX_CIRCLE_NAME_LENGTH) throw new InvalidCircleNameError();
  return trimmed;
}

/**
 * Normalise an emblem to null (cleared) or exactly one grapheme cluster. Any
 * multi-character string is rejected — the field is a flag, not a word.
 */
function validateEmblem(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) return null;
  if (graphemeCount(trimmed) !== 1) throw new InvalidEmblemError();
  return trimmed;
}

/** Validate a colour is a #rrggbb hex string; null/undefined means "leave unchanged". */
function validateColour(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) throw new InvalidColourError();
  return raw;
}

/**
 * Normalise a header image choice. `null` clears it (fall back to the
 * deterministic default); a non-null value must be one of the curated
 * collection keys (HEADER_KEYS), else InvalidHeaderImageError. A URL is never
 * accepted — the column stores a key only.
 */
function validateHeaderImage(raw: string | null): string | null {
  if (raw === null) return null;
  if (!isHeaderKey(raw)) throw new InvalidHeaderImageError();
  return raw;
}

/**
 * Validate a maxMembers value's RANGE only (null = uncapped; otherwise an
 * integer in [MIN_MAX_MEMBERS, MAX_MAX_MEMBERS]). The "not below current member
 * count" rule is enforced separately at update time, where the count is known.
 */
function validateMaxMembersRange(raw: number | null): number | null {
  if (raw === null) return null;
  if (!Number.isInteger(raw) || raw < MIN_MAX_MEMBERS || raw > MAX_MAX_MEMBERS) {
    throw new InvalidMaxMembersError(`member limit must be a whole number from ${MIN_MAX_MEMBERS} to ${MAX_MAX_MEMBERS}`);
  }
  return raw;
}

/** Throws InvalidHomeVenueError unless `venueId` references an existing venue. */
async function assertVenueExists(db: CuatroDb, venueId: string): Promise<void> {
  const [row] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  if (!row) throw new InvalidHomeVenueError();
}

/** Current member count for a Circle. */
async function memberCountOf(db: CuatroDb, circleId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, circleId));
  return row?.n ?? 0;
}

/**
 * The single insert path for "this user is now a real member of this Circle".
 * `onConflictDoNothing().returning()` makes it atomic and idempotent — a
 * returned row means this call created the membership, an empty result means
 * it already existed. Returns whether a NEW membership was created.
 *
 * MUST BE CALLED INSIDE A TRANSACTION (`tx`). Postgres MVCC does not serialize
 * writers the way better-sqlite3 did, so the capacity read-then-insert takes an
 * explicit `SELECT ... FOR UPDATE` on the anchoring Circle row first: that
 * serializes concurrent joins against the same Circle so two racing joiners
 * can't both pass the cap check and overflow the roster. Callers are
 * joinCircle, joinGuestCircle, and decideCircleKnock's accept path — each wraps
 * this in its own `db.transaction(async (tx) => …)`.
 *
 * CAPACITY: when the Circle has a `maxMembers` cap, a NEW member is rejected
 * with CircleFullError once the roster is at the cap. An already-present member
 * re-inserting is a no-op and is never blocked (they already hold a slot).
 */
export async function insertCircleMembership(
  tx: CuatroDb,
  circleId: string,
  userId: string,
  role: "organiser" | "member" = "member",
): Promise<boolean> {
  // Lock the Circle row before the capacity decision — the race guard (see the
  // doc comment). Harmless for uncapped Circles; it is a low-contention row.
  const [cap] = await tx
    .select({ maxMembers: circles.maxMembers })
    .from(circles)
    .where(eq(circles.id, circleId))
    .for("update");
  if (cap?.maxMembers != null) {
    const [alreadyMember] = await tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
    if (!alreadyMember && (await memberCountOf(tx, circleId)) >= cap.maxMembers) {
      throw new CircleFullError();
    }
  }

  const inserted = await tx
    .insert(circleMembers)
    .values({ circleId, userId, role })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

function toCircleSummary(circle: Circle, memberCount: number, myRole: "organiser" | "member"): CircleSummary {
  return {
    id: circle.id,
    name: circle.name,
    emblem: circle.emblem,
    colour: circle.colour,
    headerImage: circle.headerImage,
    countryCode: circle.countryCode,
    timezone: circle.timezone,
    inviteCode: circle.inviteCode,
    createdBy: circle.createdBy,
    createdAt: new Date(circle.createdAt),
    memberCount,
    maxMembers: circle.maxMembers,
    myRole,
  };
}

export interface CirclesStoreOptions {
  /** Injectable for tests that need to force an invite-code collision. */
  generateInviteCode?: () => string;
}

export function createCirclesStore(db: CuatroDb, options: CirclesStoreOptions = {}): CirclesStore {
  const generateCode = options.generateInviteCode ?? defaultGenerateInviteCode;

  async function requireMembership(circleId: string, userId: string) {
    const [membership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
    if (!membership) throw new NotMemberError();
    return membership;
  }

  return {
    async createCircle(input) {
      const name = validateCircleName(input.name);
      const emblem = validateEmblem(input.emblem);
      const colour = validateColour(input.colour) ?? CIRCLE_COLOUR_PRESETS[0];
      const headerImage = validateHeaderImage(input.headerImage ?? null);
      const maxMembers = validateMaxMembersRange(input.maxMembers ?? null);
      const homeVenueId = input.homeVenueId ?? null;
      if (homeVenueId !== null) await assertVenueExists(db, homeVenueId);

      let lastErr: unknown;
      for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
        const inviteCode = generateCode();
        try {
          // Circle + creator membership atomically: an invite-code collision
          // rolls the whole thing back so the retry doesn't orphan a circle.
          const circle = await db.transaction(async (tx) => {
            const [created] = await tx
              .insert(circles)
              .values({
                name,
                emblem,
                colour,
                headerImage,
                homeVenueId,
                maxMembers,
                countryCode: input.countryCode ?? "GB",
                timezone: input.timezone ?? "Europe/London",
                inviteCode,
                createdBy: input.creatorUserId,
              })
              .returning();

            await tx.insert(circleMembers).values({
              circleId: created.id,
              userId: input.creatorUserId,
              role: "organiser",
            });
            return created;
          });

          return toCircleSummary(circle, 1, "organiser");
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            lastErr = err;
            continue;
          }
          throw err;
        }
      }
      throw new Error(
        `could not generate a unique invite code after ${MAX_INVITE_CODE_ATTEMPTS} attempts`,
        { cause: lastErr },
      );
    },

    async getCircleByInviteCode(inviteCode) {
      const [circle] = await db
        .select({
          id: circles.id,
          name: circles.name,
          emblem: circles.emblem,
          colour: circles.colour,
          headerImage: circles.headerImage,
          maxMembers: circles.maxMembers,
          memberCount: sql<number>`(select cast(count(*) as int) from circle_members cm where cm.circle_id = ${circles.id})`,
        })
        .from(circles)
        .where(eq(circles.inviteCode, inviteCode));
      if (!circle) return null;
      return { ...circle, memberCount: Number(circle.memberCount) };
    },

    async joinCircle({ inviteCode, userId }) {
      const [circle] = await db.select().from(circles).where(eq(circles.inviteCode, inviteCode));
      if (!circle) return null;

      try {
        // insertCircleMembership locks the Circle row for its capacity check,
        // so it must run inside a transaction (see its doc comment).
        const created = await db.transaction((tx) => insertCircleMembership(tx, circle.id, userId));
        return { circleId: circle.id, circleName: circle.name, alreadyMember: !created, full: false };
      } catch (err) {
        if (err instanceof CircleFullError) {
          return { circleId: circle.id, circleName: circle.name, alreadyMember: false, full: true };
        }
        throw err;
      }
    },

    async listCirclesForUser(userId) {
      const rows = await db
        .select({
          circle: circles,
          role: circleMembers.role,
          memberCount: sql<number>`(select cast(count(*) as int) from circle_members cm2 where cm2.circle_id = ${circles.id})`,
        })
        .from(circleMembers)
        .innerJoin(circles, eq(circleMembers.circleId, circles.id))
        .where(eq(circleMembers.userId, userId))
        .orderBy(desc(circles.createdAt));

      return rows.map((row) => toCircleSummary(row.circle, Number(row.memberCount), row.role));
    },

    async getCircleDetail(circleId, requestingUserId) {
      const [circle] = await db.select().from(circles).where(eq(circles.id, circleId));
      if (!circle) return null;

      const myMembership = await requireMembership(circleId, requestingUserId);

      const memberRows = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          role: circleMembers.role,
          joinedAt: circleMembers.joinedAt,
          rating: users.rating,
          confidence: users.confidence,
          rsvpInCount: users.rsvpInCount,
          showUpCount: users.showUpCount,
          verifiedMatchCount: users.verifiedMatchCount,
        })
        .from(circleMembers)
        .innerJoin(users, eq(circleMembers.userId, users.id))
        .where(eq(circleMembers.circleId, circleId))
        .orderBy(asc(circleMembers.joinedAt));

      const members: CircleMemberView[] = memberRows.map((row) => ({
        userId: row.userId,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        role: row.role,
        joinedAt: new Date(row.joinedAt),
        rating: row.rating,
        confidence: row.confidence,
        reliability: row.rsvpInCount > 0 ? Math.min(1, row.showUpCount / row.rsvpInCount) : null,
        verifiedMatchCount: row.verifiedMatchCount,
      }));

      // Resolve the explicit home venue's name/address when one is set (cheap
      // single-row lookup). Null otherwise — the anchor derives from usage.
      let homeVenueName: string | null = null;
      let homeVenueAddress: string | null = null;
      if (circle.homeVenueId) {
        const [venue] = await db
          .select({ name: venues.name, address: venues.address })
          .from(venues)
          .where(eq(venues.id, circle.homeVenueId));
        homeVenueName = venue?.name ?? null;
        homeVenueAddress = venue?.address ?? null;
      }

      return {
        id: circle.id,
        name: circle.name,
        emblem: circle.emblem,
        colour: circle.colour,
        countryCode: circle.countryCode,
        timezone: circle.timezone,
        inviteCode: circle.inviteCode,
        createdBy: circle.createdBy,
        openDoor: circle.openDoor,
        boardEnabled: circle.boardEnabled,
        vibeLine: circle.vibeLine,
        headerImage: circle.headerImage,
        homeVenueId: circle.homeVenueId,
        homeVenueName,
        homeVenueAddress,
        maxMembers: circle.maxMembers,
        memberCount: members.length,
        myRole: myMembership.role,
        members,
      };
    },

    async updateCircleSettings(circleId, requestingUserId, updates) {
      const membership = await requireMembership(circleId, requestingUserId);
      if (membership.role !== "organiser") throw new NotOrganiserError();

      const patch: Partial<typeof circles.$inferInsert> = {};
      if (updates.name !== undefined) patch.name = validateCircleName(updates.name);
      if (updates.emblem !== undefined) patch.emblem = validateEmblem(updates.emblem);
      if (updates.colour !== undefined) {
        const colour = validateColour(updates.colour);
        if (colour !== undefined) patch.colour = colour;
      }
      if (updates.timezone !== undefined) patch.timezone = updates.timezone;
      if (updates.openDoor !== undefined) patch.openDoor = updates.openDoor;
      if (updates.boardEnabled !== undefined) patch.boardEnabled = updates.boardEnabled;
      if (updates.vibeLine !== undefined) {
        // An empty (or whitespace-only) vibe line clears it back to null so the
        // directory card falls back to its default line rather than a blank.
        const trimmed = updates.vibeLine?.trim() ?? "";
        patch.vibeLine = trimmed.length === 0 ? null : trimmed.slice(0, MAX_VIBE_LINE_LENGTH);
      }
      if (updates.headerImage !== undefined) patch.headerImage = validateHeaderImage(updates.headerImage);
      if (updates.homeVenueId !== undefined) {
        if (updates.homeVenueId !== null) await assertVenueExists(db, updates.homeVenueId);
        patch.homeVenueId = updates.homeVenueId;
      }
      if (updates.maxMembers !== undefined) {
        const next = validateMaxMembersRange(updates.maxMembers);
        // A cap can never be set below the roster it already holds — that would
        // leave the Circle permanently "over" its own limit.
        if (next !== null) {
          const current = await memberCountOf(db, circleId);
          if (next < current) {
            throw new InvalidMaxMembersError(
              `member limit cannot be below the current member count (${current})`,
            );
          }
        }
        patch.maxMembers = next;
      }
      if (Object.keys(patch).length === 0) return;

      await db.update(circles).set(patch).where(eq(circles.id, circleId));
    },

    async postMessage({ circleId, userId, body }) {
      const trimmed = body.trim();
      if (!trimmed) throw new EmptyMessageError();
      if (trimmed.length > MAX_MESSAGE_LENGTH) throw new MessageTooLongError();

      await requireMembership(circleId, userId);

      const [row] = await db.insert(circleMessages).values({ circleId, userId, body: trimmed }).returning();
      const [author] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));

      const message: CircleMessageView = {
        id: row.id,
        circleId: row.circleId,
        userId: row.userId,
        displayName: author?.displayName ?? "Unknown",
        body: row.body,
        createdAt: new Date(row.createdAt),
      };
      emitCircleEvent(circleId, "message", { messageId: message.id });
      return message;
    },

    async listMessages(circleId, requestingUserId, opts) {
      await requireMembership(circleId, requestingUserId);

      const conditions = [eq(circleMessages.circleId, circleId)];
      if (opts?.after) conditions.push(gt(circleMessages.createdAt, opts.after.getTime()));

      const rows = await db
        .select({
          id: circleMessages.id,
          circleId: circleMessages.circleId,
          userId: circleMessages.userId,
          body: circleMessages.body,
          createdAt: circleMessages.createdAt,
          displayName: users.displayName,
        })
        .from(circleMessages)
        .innerJoin(users, eq(circleMessages.userId, users.id))
        .where(and(...conditions))
        // circle_messages.seq (a monotonic GENERATED identity), not created_at,
        // is the sort key — Postgres has no rowid, and ms-resolution timestamps
        // alone can't recover insertion order within the same millisecond. See
        // the schema comment on circleMessages + the foundation manifest §6.
        .orderBy(asc(circleMessages.seq))
        .limit(opts?.limit ?? DEFAULT_MESSAGE_LIMIT);

      return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
    },
  };
}

let storePromise: Promise<CirclesStore> | null = null;

export function getCirclesStore(): Promise<CirclesStore> {
  if (!storePromise) {
    storePromise = createClient().then(({ db }) => createCirclesStore(db));
  }
  return storePromise;
}

/** Test-only: force a fresh store on next getCirclesStore() call. */
export function __resetCirclesStoreForTests() {
  storePromise = null;
}
