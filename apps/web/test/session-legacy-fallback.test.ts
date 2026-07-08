import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getSession = vi.fn();
const getUserBySupabaseId = vi.fn();
let legacyCookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "cuatro_session" && legacyCookieValue ? { value: legacyCookieValue } : undefined,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

vi.mock("@/lib/auth-store", () => ({
  getAuthStore: vi.fn(async () => ({ getSession, getUserBySupabaseId })),
}));

import { getSessionUser, legacyAuthEnabled } from "@/lib/session";

describe("getSessionUser — Supabase-first with an AUTH_LEGACY-gated fallback", () => {
  const originalFlag = process.env.AUTH_LEGACY;

  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: null } });
    getSession.mockReset();
    getUserBySupabaseId.mockReset();
    legacyCookieValue = undefined;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTH_LEGACY;
    else process.env.AUTH_LEGACY = originalFlag;
  });

  it("returns null when there's no Supabase session and AUTH_LEGACY is off", async () => {
    delete process.env.AUTH_LEGACY;
    legacyCookieValue = "some-legacy-token";

    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls back to the legacy cookie session when AUTH_LEGACY=1", async () => {
    process.env.AUTH_LEGACY = "1";
    legacyCookieValue = "legacy-token-abc";
    getSession.mockResolvedValue({ id: "u1", email: "legacy@example.com", displayName: "legacy" });

    const user = await getSessionUser();

    expect(getSession).toHaveBeenCalledWith("legacy-token-abc");
    expect(user).toEqual({ id: "u1", email: "legacy@example.com", displayName: "legacy" });
  });

  it("returns null when AUTH_LEGACY=1 but there's no legacy cookie either", async () => {
    process.env.AUTH_LEGACY = "1";
    legacyCookieValue = undefined;

    const user = await getSessionUser();

    expect(user).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("prefers the Supabase session over the legacy cookie, regardless of AUTH_LEGACY", async () => {
    process.env.AUTH_LEGACY = "1";
    legacyCookieValue = "legacy-token-abc";
    getUser.mockResolvedValue({ data: { user: { id: "sb-1", email: "player@example.com" } } });
    getUserBySupabaseId.mockResolvedValue({
      id: "local-1",
      email: "player@example.com",
      displayName: "player",
    });

    const user = await getSessionUser();

    expect(getUserBySupabaseId).toHaveBeenCalledWith("sb-1");
    expect(getSession).not.toHaveBeenCalled();
    expect(user).toEqual({ id: "local-1", email: "player@example.com", displayName: "player" });
  });

  it("treats a Supabase session with no matching local user as signed out, without provisioning", async () => {
    delete process.env.AUTH_LEGACY;
    getUser.mockResolvedValue({ data: { user: { id: "sb-orphan", email: "orphan@example.com" } } });
    getUserBySupabaseId.mockResolvedValue(null);

    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("legacyAuthEnabled reflects the live AUTH_LEGACY env var", () => {
    delete process.env.AUTH_LEGACY;
    expect(legacyAuthEnabled()).toBe(false);

    process.env.AUTH_LEGACY = "1";
    expect(legacyAuthEnabled()).toBe(true);

    process.env.AUTH_LEGACY = "0";
    expect(legacyAuthEnabled()).toBe(false);
  });
});
