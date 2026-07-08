import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFallbackAuthStore } from "@/lib/db-fallback";
import type { AuthStore } from "@/lib/auth-store";

describe("fallback auth store", () => {
  let dbPath: string;
  let store: AuthStore;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `cuatro-test-${Date.now()}-${Math.random()}.db`);
    store = createFallbackAuthStore(dbPath);
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = dbPath + suffix;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  it("issues a magic link token and verifies it into a session", async () => {
    const user = await store.findOrCreateUserByEmail("Organiser@Example.com");
    expect(user.email).toBe("organiser@example.com");
    expect(user.displayName).toBeNull();

    const token = await store.createMagicLinkToken(user.id, user.email);
    expect(token).toHaveLength(64);

    const consumed = await store.consumeMagicLinkToken(token);
    expect(consumed).toEqual({ userId: user.id, email: user.email });

    const sessionToken = await store.createSession(user.id);
    const sessionUser = await store.getSession(sessionToken);
    expect(sessionUser).toEqual(user);
  });

  it("rejects a magic link token used twice", async () => {
    const user = await store.findOrCreateUserByEmail("player@example.com");
    const token = await store.createMagicLinkToken(user.id, user.email);

    const first = await store.consumeMagicLinkToken(token);
    expect(first).not.toBeNull();

    const second = await store.consumeMagicLinkToken(token);
    expect(second).toBeNull();
  });

  it("rejects an unknown session token", async () => {
    const result = await store.getSession("does-not-exist");
    expect(result).toBeNull();
  });

  it("finding a user by the same email twice returns the same id", async () => {
    const first = await store.findOrCreateUserByEmail("dup@example.com");
    const second = await store.findOrCreateUserByEmail("dup@example.com");
    expect(second.id).toBe(first.id);
  });

  it("deleting a session invalidates it", async () => {
    const user = await store.findOrCreateUserByEmail("logout@example.com");
    const sessionToken = await store.createSession(user.id);

    expect(await store.getSession(sessionToken)).not.toBeNull();
    await store.deleteSession(sessionToken);
    expect(await store.getSession(sessionToken)).toBeNull();
  });

  it("updates a display name", async () => {
    const user = await store.findOrCreateUserByEmail("name@example.com");
    await store.updateDisplayName(user.id, "Jamie");

    const sessionToken = await store.createSession(user.id);
    const sessionUser = await store.getSession(sessionToken);
    expect(sessionUser?.displayName).toBe("Jamie");
  });
});
