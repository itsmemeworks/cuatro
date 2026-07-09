/**
 * Legacy fallback persistence for auth. The app now uses the real
 * @cuatro/db-backed store (see auth-store.ts); this file is kept only for
 * its own standalone test (test/auth-store-fallback.test.ts) and is not
 * wired into getAuthStore() anymore. Raw better-sqlite3 against a shadow
 * copy of the same three tables @cuatro/db owns: users, magic_link_tokens,
 * sessions_auth.
 */
import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "crypto";
import type { AuthStore, SessionUser, SupabaseProvisionParams } from "./auth-store";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      supabase_user_id TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS magic_link_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions_auth (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function toSessionUser(row: { id: string; email: string; display_name: string | null }): SessionUser {
  // This shadow schema has no avatar_url column — the legacy fallback
  // predates avatars entirely and isn't wired into getAuthStore() (see the
  // file header), so there's no photo to carry through.
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: null };
}

export function createFallbackAuthStore(path: string): AuthStore {
  const db = openDb(path);

  return {
    async findOrCreateUserByEmail(email: string): Promise<SessionUser> {
      const normalized = email.trim().toLowerCase();
      const existing = db
        .prepare("SELECT id, email, display_name FROM users WHERE email = ?")
        .get(normalized) as { id: string; email: string; display_name: string | null } | undefined;
      if (existing) return toSessionUser(existing);

      const id = randomUUID();
      db.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, NULL, ?)"
      ).run(id, normalized, new Date().toISOString());
      return { id, email: normalized, displayName: null, avatarUrl: null };
    },

    async createMagicLinkToken(userId: string, email: string): Promise<string> {
      const token = randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
      db.prepare(
        "INSERT INTO magic_link_tokens (token, user_id, email, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
      ).run(token, userId, email, expiresAt.toISOString(), now.toISOString());
      return token;
    },

    async consumeMagicLinkToken(token: string) {
      const row = db
        .prepare(
          "SELECT token, user_id, email, expires_at, consumed_at FROM magic_link_tokens WHERE token = ?"
        )
        .get(token) as
        | { token: string; user_id: string; email: string; expires_at: string; consumed_at: string | null }
        | undefined;

      if (!row) return null;
      if (row.consumed_at) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) return null;

      db.prepare("UPDATE magic_link_tokens SET consumed_at = ? WHERE token = ?").run(
        new Date().toISOString(),
        token
      );
      return { userId: row.user_id, email: row.email };
    },

    async createSession(userId: string): Promise<string> {
      const token = randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      db.prepare(
        "INSERT INTO sessions_auth (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
      ).run(token, userId, expiresAt.toISOString(), now.toISOString());
      return token;
    },

    async getSession(sessionToken: string): Promise<SessionUser | null> {
      const row = db
        .prepare(
          `SELECT u.id as id, u.email as email, u.display_name as display_name, s.expires_at as expires_at
           FROM sessions_auth s JOIN users u ON u.id = s.user_id
           WHERE s.token = ?`
        )
        .get(sessionToken) as
        | { id: string; email: string; display_name: string | null; expires_at: string }
        | undefined;

      if (!row) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) return null;
      return toSessionUser(row);
    },

    async deleteSession(sessionToken: string): Promise<void> {
      db.prepare("DELETE FROM sessions_auth WHERE token = ?").run(sessionToken);
    },

    async updateDisplayName(userId: string, displayName: string): Promise<void> {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
    },

    async findOrCreateUserBySupabase(params: SupabaseProvisionParams): Promise<SessionUser> {
      const normalized = params.email.trim().toLowerCase();

      const bySupabaseId = db
        .prepare("SELECT id, email, display_name FROM users WHERE supabase_user_id = ?")
        .get(params.supabaseUserId) as
        | { id: string; email: string; display_name: string | null }
        | undefined;
      if (bySupabaseId) return toSessionUser(bySupabaseId);

      const byEmail = db
        .prepare("SELECT id, email, display_name FROM users WHERE email = ?")
        .get(normalized) as { id: string; email: string; display_name: string | null } | undefined;
      if (byEmail) {
        db.prepare("UPDATE users SET supabase_user_id = ? WHERE id = ?").run(
          params.supabaseUserId,
          byEmail.id
        );
        return toSessionUser(byEmail);
      }

      const id = randomUUID();
      const displayName = params.displayName?.trim() || null;
      db.prepare(
        "INSERT INTO users (id, email, display_name, supabase_user_id, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(id, normalized, displayName, params.supabaseUserId, new Date().toISOString());
      return { id, email: normalized, displayName, avatarUrl: null };
    },

    async getUserBySupabaseId(supabaseUserId: string): Promise<SessionUser | null> {
      const row = db
        .prepare("SELECT id, email, display_name FROM users WHERE supabase_user_id = ?")
        .get(supabaseUserId) as { id: string; email: string; display_name: string | null } | undefined;
      return row ? toSessionUser(row) : null;
    },
  };
}
