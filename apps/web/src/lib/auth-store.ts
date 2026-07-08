/**
 * Auth persistence, backed by @cuatro/db (drizzle + better-sqlite3). This is
 * the ONE place the rest of the app talks to for auth storage.
 *
 * Two provisioning paths write the same `users` table:
 *   - findOrCreateUserByEmail + createMagicLinkToken/consumeMagicLinkToken —
 *     the legacy custom magic-link flow, gated behind AUTH_LEGACY=1 (see
 *     ../app/api/auth/{request,verify}/route.ts and ./session.ts).
 *   - findOrCreateUserBySupabase — the primary flow, called once from
 *     /auth/callback after Supabase exchanges its own auth code. It links
 *     onto a legacy-created row by email if one exists, rather than
 *     duplicating the user.
 *
 * Gotchas this implementation has to respect:
 *   - magicLinkTokens/authSessions store `tokenHash`, not the raw token —
 *     the raw token only ever exists in the magic-link URL / session cookie.
 *   - users.displayName is NOT NULL with no default — seeded from the email
 *     local-part on first insert.
 *   - the session table is exported as `authSessions`, mapped to SQL table
 *     `sessions_auth` (not `sessions`, which is the game-instance table).
 *   - magicLinkTokens has no userId column (only email) — consuming a token
 *     re-resolves the user by email.
 *   - timestamps are `Date` objects (drizzle's timestamp_ms mode), not ISO
 *     strings — compare with `.getTime()`.
 *
 * The legacy raw-better-sqlite3 fallback lives in ./db-fallback.ts; it is no
 * longer wired into the app and exists only for its own test.
 */
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { createClient, users, magicLinkTokens, authSessions } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface SupabaseProvisionParams {
  supabaseUserId: string;
  email: string;
  displayName?: string | null;
}

export interface AuthStore {
  findOrCreateUserByEmail(email: string): Promise<SessionUser>;
  createMagicLinkToken(userId: string, email: string): Promise<string>;
  consumeMagicLinkToken(token: string): Promise<{ userId: string; email: string } | null>;
  createSession(userId: string): Promise<string>;
  getSession(sessionToken: string): Promise<SessionUser | null>;
  deleteSession(sessionToken: string): Promise<void>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
  /**
   * Maps a Supabase Auth user onto a local `users` row — called once, from
   * /auth/callback, right after exchangeCodeForSession. Lookup order:
   * by supabaseUserId (returning player) -> by email (links an account that
   * pre-dates Supabase Auth, e.g. one created via the legacy magic-link
   * store) -> create fresh (displayName from Supabase user_metadata.name,
   * falling back to the email local-part; countryCode defaults to GB same
   * as the legacy path).
   */
  findOrCreateUserBySupabase(params: SupabaseProvisionParams): Promise<SessionUser>;
  /** Read-only lookup for session resolution — never provisions. */
  getUserBySupabaseId(supabaseUserId: string): Promise<SessionUser | null>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** First login has no display name yet — default to the email local-part. */
function deriveDisplayName(email: string): string {
  return email.split("@")[0] || email;
}

function toSessionUser(row: { id: string; email: string; displayName: string }): SessionUser {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export function createDrizzleAuthStore(dbPath?: string): AuthStore {
  const { db }: CuatroClient = createClient(dbPath);

  return {
    async findOrCreateUserByEmail(email: string): Promise<SessionUser> {
      const normalized = email.trim().toLowerCase();
      const [existing] = await db.select().from(users).where(eq(users.email, normalized));
      if (existing) return toSessionUser(existing);

      const [created] = await db
        .insert(users)
        .values({ email: normalized, displayName: deriveDisplayName(normalized) })
        .returning();
      return toSessionUser(created);
    },

    async createMagicLinkToken(_userId: string, email: string): Promise<string> {
      const token = randomBytes(32).toString("hex");
      await db.insert(magicLinkTokens).values({
        tokenHash: hashToken(token),
        email: email.trim().toLowerCase(),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      });
      return token;
    },

    async consumeMagicLinkToken(token: string) {
      const tokenHash = hashToken(token);
      const [row] = await db
        .select()
        .from(magicLinkTokens)
        .where(eq(magicLinkTokens.tokenHash, tokenHash));

      if (!row) return null;
      if (row.usedAt) return null;
      if (row.expiresAt.getTime() < Date.now()) return null;

      await db
        .update(magicLinkTokens)
        .set({ usedAt: new Date() })
        .where(eq(magicLinkTokens.id, row.id));

      const [user] = await db.select().from(users).where(eq(users.email, row.email));
      if (!user) return null;
      return { userId: user.id, email: row.email };
    },

    async createSession(userId: string): Promise<string> {
      const token = randomBytes(32).toString("hex");
      await db.insert(authSessions).values({
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      return token;
    },

    async getSession(sessionToken: string): Promise<SessionUser | null> {
      const tokenHash = hashToken(sessionToken);
      const [row] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .innerJoin(users, eq(authSessions.userId, users.id))
        .where(eq(authSessions.tokenHash, tokenHash));

      if (!row) return null;
      if (row.expiresAt.getTime() < Date.now()) return null;
      return toSessionUser(row);
    },

    async deleteSession(sessionToken: string): Promise<void> {
      await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(sessionToken)));
    },

    async updateDisplayName(userId: string, displayName: string): Promise<void> {
      await db.update(users).set({ displayName, updatedAt: new Date() }).where(eq(users.id, userId));
    },

    async findOrCreateUserBySupabase(params: SupabaseProvisionParams): Promise<SessionUser> {
      const normalized = params.email.trim().toLowerCase();

      const [bySupabaseId] = await db
        .select()
        .from(users)
        .where(eq(users.supabaseUserId, params.supabaseUserId));
      if (bySupabaseId) return toSessionUser(bySupabaseId);

      const [byEmail] = await db.select().from(users).where(eq(users.email, normalized));
      if (byEmail) {
        const [linked] = await db
          .update(users)
          .set({ supabaseUserId: params.supabaseUserId, updatedAt: new Date() })
          .where(eq(users.id, byEmail.id))
          .returning();
        return toSessionUser(linked);
      }

      const [created] = await db
        .insert(users)
        .values({
          email: normalized,
          displayName: params.displayName?.trim() || deriveDisplayName(normalized),
          supabaseUserId: params.supabaseUserId,
          countryCode: "GB",
        })
        .returning();
      return toSessionUser(created);
    },

    async getUserBySupabaseId(supabaseUserId: string): Promise<SessionUser | null> {
      const [row] = await db.select().from(users).where(eq(users.supabaseUserId, supabaseUserId));
      return row ? toSessionUser(row) : null;
    },
  };
}

let storePromise: Promise<AuthStore> | null = null;

export function getAuthStore(): Promise<AuthStore> {
  if (!storePromise) storePromise = Promise.resolve(createDrizzleAuthStore());
  return storePromise;
}

/** Test-only: force a fresh store on next getAuthStore() call. */
export function __resetAuthStoreForTests() {
  storePromise = null;
}
