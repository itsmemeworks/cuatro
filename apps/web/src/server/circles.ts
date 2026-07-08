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
 * Chat delivery: an in-process EventEmitter-style listener map broadcasts
 * new messages to open SSE connections (see
 * app/api/circles/[id]/messages/stream/route.ts). This only works because
 * the app runs as a single Fly machine (fly.toml: no multi-machine http
 * service config) — a second instance would miss messages published on the
 * other one. If/when this app scales beyond one machine, replace the
 * in-memory map with a real pub/sub (e.g. a SQLite `notify` polling loop or
 * Redis) without changing the `postMessage`/`subscribeToCircleMessages`
 * call sites.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { createClient, circleMembers, circleMessages, circles, users } from "@cuatro/db";
import type { CuatroDb, Circle } from "@cuatro/db";

const MAX_INVITE_CODE_ATTEMPTS = 8;
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MESSAGE_LIMIT = 200;

// Unambiguous, URL-safe alphabet: no 0/O, 1/I/L — the characters people most
// often misread off a screenshot or a shouted-across-the-court invite code.
const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;

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

export interface CircleSummary {
  id: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  countryCode: string;
  timezone: string;
  inviteCode: string;
  createdBy: string;
  createdAt: Date;
  memberCount: number;
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
  countryCode?: string;
  timezone?: string;
  creatorUserId: string;
}

export interface UpdateCircleSettingsInput {
  name?: string;
  emblem?: string | null;
  colour?: string | null;
  timezone?: string;
}

export interface JoinCircleResult {
  circleId: string;
  circleName: string;
  alreadyMember: boolean;
}

export interface CirclesStore {
  createCircle(input: CreateCircleInput): Promise<CircleSummary>;
  getCircleByInviteCode(
    inviteCode: string,
  ): Promise<{ id: string; name: string; emblem: string | null; colour: string | null } | null>;
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

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

function toCircleSummary(circle: Circle, memberCount: number, myRole: "organiser" | "member"): CircleSummary {
  return {
    id: circle.id,
    name: circle.name,
    emblem: circle.emblem,
    colour: circle.colour,
    countryCode: circle.countryCode,
    timezone: circle.timezone,
    inviteCode: circle.inviteCode,
    createdBy: circle.createdBy,
    createdAt: circle.createdAt,
    memberCount,
    myRole,
  };
}

// circleId -> listeners. Process-global (not per-store-instance) so every
// postMessage() call reaches every open SSE connection in this process,
// regardless of which CirclesStore instance handled the write.
const messageListeners = new Map<string, Set<(message: CircleMessageView) => void>>();

function publishMessage(message: CircleMessageView): void {
  const listeners = messageListeners.get(message.circleId);
  if (!listeners) return;
  for (const listener of listeners) listener(message);
}

/** Subscribe to new messages in a Circle; returns an unsubscribe function. */
export function subscribeToCircleMessages(
  circleId: string,
  listener: (message: CircleMessageView) => void,
): () => void {
  let listeners = messageListeners.get(circleId);
  if (!listeners) {
    listeners = new Set();
    messageListeners.set(circleId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) messageListeners.delete(circleId);
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
      let lastErr: unknown;
      for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
        const inviteCode = generateCode();
        try {
          const [circle] = await db
            .insert(circles)
            .values({
              name: input.name.trim(),
              emblem: input.emblem ?? null,
              colour: input.colour ?? CIRCLE_COLOUR_PRESETS[0],
              countryCode: input.countryCode ?? "GB",
              timezone: input.timezone ?? "Europe/London",
              inviteCode,
              createdBy: input.creatorUserId,
            })
            .returning();

          await db.insert(circleMembers).values({
            circleId: circle.id,
            userId: input.creatorUserId,
            role: "organiser",
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
        .select({ id: circles.id, name: circles.name, emblem: circles.emblem, colour: circles.colour })
        .from(circles)
        .where(eq(circles.inviteCode, inviteCode));
      return circle ?? null;
    },

    async joinCircle({ inviteCode, userId }) {
      const [circle] = await db.select().from(circles).where(eq(circles.inviteCode, inviteCode));
      if (!circle) return null;

      // onConflictDoNothing().returning() makes this atomic and idempotent
      // in one round trip: a returned row means this call created the
      // membership, an empty result means it already existed.
      const [inserted] = await db
        .insert(circleMembers)
        .values({ circleId: circle.id, userId, role: "member" })
        .onConflictDoNothing()
        .returning();

      return { circleId: circle.id, circleName: circle.name, alreadyMember: !inserted };
    },

    async listCirclesForUser(userId) {
      const rows = await db
        .select({
          circle: circles,
          role: circleMembers.role,
          memberCount: sql<number>`(select count(*) from circle_members cm2 where cm2.circle_id = ${circles.id})`,
        })
        .from(circleMembers)
        .innerJoin(circles, eq(circleMembers.circleId, circles.id))
        .where(eq(circleMembers.userId, userId))
        .orderBy(sql`${circles.createdAt} desc`);

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
        joinedAt: row.joinedAt,
        rating: row.rating,
        confidence: row.confidence,
        reliability: row.rsvpInCount > 0 ? row.showUpCount / row.rsvpInCount : null,
      }));

      return {
        id: circle.id,
        name: circle.name,
        emblem: circle.emblem,
        colour: circle.colour,
        countryCode: circle.countryCode,
        timezone: circle.timezone,
        inviteCode: circle.inviteCode,
        createdBy: circle.createdBy,
        myRole: myMembership.role,
        members,
      };
    },

    async updateCircleSettings(circleId, requestingUserId, updates) {
      const membership = await requireMembership(circleId, requestingUserId);
      if (membership.role !== "organiser") throw new NotOrganiserError();

      const patch: Partial<typeof circles.$inferInsert> = {};
      if (updates.name !== undefined) patch.name = updates.name.trim();
      if (updates.emblem !== undefined) patch.emblem = updates.emblem;
      if (updates.colour !== undefined) patch.colour = updates.colour;
      if (updates.timezone !== undefined) patch.timezone = updates.timezone;
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
        createdAt: row.createdAt,
      };
      publishMessage(message);
      return message;
    },

    async listMessages(circleId, requestingUserId, opts) {
      await requireMembership(circleId, requestingUserId);

      const conditions = [eq(circleMessages.circleId, circleId)];
      if (opts?.after) conditions.push(gt(circleMessages.createdAt, opts.after));

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
        // circle_messages.rowid, not created_at, is the sort key — see the
        // schema comment on circleMessages for why ms-resolution timestamps
        // alone aren't a safe way to recover insertion order. Qualified
        // because the join brings in users' rowid too.
        .orderBy(sql`circle_messages.rowid asc`)
        .limit(opts?.limit ?? DEFAULT_MESSAGE_LIMIT);

      return rows;
    },
  };
}

let storePromise: Promise<CirclesStore> | null = null;

export function getCirclesStore(): Promise<CirclesStore> {
  if (!storePromise) {
    const { db } = createClient();
    storePromise = Promise.resolve(createCirclesStore(db));
  }
  return storePromise;
}

/** Test-only: force a fresh store on next getCirclesStore() call. */
export function __resetCirclesStoreForTests() {
  storePromise = null;
}
