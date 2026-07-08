import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleAuthStore, type AuthStore } from "@/lib/auth-store";

describe("drizzle auth store (@cuatro/db)", () => {
  let store: AuthStore;

  beforeEach(() => {
    store = createDrizzleAuthStore(":memory:");
  });

  it("creates a user with a display name derived from the email local-part", async () => {
    const user = await store.findOrCreateUserByEmail("Organiser@Example.com");
    expect(user.email).toBe("organiser@example.com");
    expect(user.displayName).toBe("organiser");
  });

  it("issues a magic link token and verifies it into a session", async () => {
    const user = await store.findOrCreateUserByEmail("player@example.com");
    const token = await store.createMagicLinkToken(user.id, user.email);
    expect(token).toHaveLength(64);

    const consumed = await store.consumeMagicLinkToken(token);
    expect(consumed).toEqual({ userId: user.id, email: user.email });

    const sessionToken = await store.createSession(user.id);
    const sessionUser = await store.getSession(sessionToken);
    expect(sessionUser).toEqual(user);
  });

  it("rejects a magic link token used twice", async () => {
    const user = await store.findOrCreateUserByEmail("twice@example.com");
    const token = await store.createMagicLinkToken(user.id, user.email);

    const first = await store.consumeMagicLinkToken(token);
    expect(first).not.toBeNull();

    const second = await store.consumeMagicLinkToken(token);
    expect(second).toBeNull();
  });

  it("rejects an unknown or tampered token", async () => {
    expect(await store.consumeMagicLinkToken("not-a-real-token")).toBeNull();
    expect(await store.getSession("not-a-real-session")).toBeNull();
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
