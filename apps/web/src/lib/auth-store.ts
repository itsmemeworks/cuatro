/**
 * Auth persistence, backed by @cuatro/db (drizzle + better-sqlite3). This is
 * the ONE place the rest of the app talks to for auth storage.
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

export interface AuthStore {
  findOrCreateUserByEmail(email: string): Promise<SessionUser>;
  createMagicLinkToken(userId: string, email: string): Promise<string>;
  consumeMagicLinkToken(token: string): Promise<{ userId: string; email: string } | null>;
  createSession(userId: string): Promise<string>;
  getSession(sessionToken: string): Promise<SessionUser | null>;
  deleteSession(sessionToken: string): Promise<void>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
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
