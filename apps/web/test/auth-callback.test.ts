import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";
import { GUEST_COOKIE } from "@/lib/guest-session";

const exchangeCodeForSession = vi.fn();
const findOrCreateUserBySupabase = vi.fn();
// vi.hoisted so these are safely readable from the vi.mock factory below —
// vi.mock calls are hoisted above ordinary top-level `const`s (unlike
// exchangeCodeForSession/findOrCreateUserBySupabase above, which only work
// because their mock factories defer the reference inside a not-yet-called
// nested function; @/server/guest's exports ARE the mocked functions
// directly, so there's no second closure to hide behind).
const { getGuestUserId, convertGuestOnAuth } = vi.hoisted(() => ({
  getGuestUserId: vi.fn(),
  convertGuestOnAuth: vi.fn(),
}));

// Both modules are mocked wholesale — the real implementations call
// next/headers' cookies() and a real sqlite client, neither of which work
// (or should run) in a plain unit test. This isolates exactly what
// /auth/callback is responsible for: reading the exchange result and
// driving provisioning + the next-param redirect. vitest hoists these
// vi.mock calls above the import above, so the route picks them up.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

vi.mock("@/lib/auth-store", () => ({
  getAuthStore: vi.fn(async () => ({ findOrCreateUserBySupabase })),
}));

// server/guest.ts's DB-touching functions and the games client are mocked
// the same wholesale way — the guest-conversion branch under test is the
// route's own wiring (read the cookie, call convertGuestOnAuth, clear the
// cookie), not server/guest.ts's actual merge logic (covered directly in
// test/guest.test.ts against a real :memory: db).
vi.mock("@/server/guest", () => ({
  getGuestUserId,
  convertGuestOnAuth,
}));

vi.mock("@/server/games-db", () => ({
  getGamesClient: vi.fn(async () => ({ db: {} })),
}));

function callbackRequest(query: string, cookies: Record<string, string> = {}): NextRequest {
  const request = new NextRequest(new URL(`https://cuatro.fly.dev/auth/callback${query}`));
  for (const [name, value] of Object.entries(cookies)) request.cookies.set(name, value);
  return request;
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    findOrCreateUserBySupabase.mockReset();
    getGuestUserId.mockReset();
    convertGuestOnAuth.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login without exchanging when no code is present", async () => {
    const res = await GET(callbackRequest(""));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/login?error=missing_code");
  });

  it("redirects to /login and skips provisioning when the exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: new Error("bad code") });

    const res = await GET(callbackRequest("?code=bad-code"));

    expect(findOrCreateUserBySupabase).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/login?error=auth_failed");
  });

  it("redirects to /login when the Supabase user has no email (can't provision a local row)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-no-email", email: null, user_metadata: {} } },
      error: null,
    });

    const res = await GET(callbackRequest("?code=abc"));

    expect(findOrCreateUserBySupabase).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/login?error=auth_failed");
  });

  it("provisions the user and redirects to /home when no next is given", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-1", email: "player@example.com", user_metadata: {} } },
      error: null,
    });

    const res = await GET(callbackRequest("?code=abc123"));

    expect(findOrCreateUserBySupabase).toHaveBeenCalledWith({
      supabaseUserId: "sb-1",
      email: "player@example.com",
      displayName: null,
    });
    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/home");
  });

  it("passes user_metadata.name through as the display name", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-2", email: "named@example.com", user_metadata: { name: "Robin" } } },
      error: null,
    });

    await GET(callbackRequest("?code=abc123"));

    expect(findOrCreateUserBySupabase).toHaveBeenCalledWith({
      supabaseUserId: "sb-2",
      email: "named@example.com",
      displayName: "Robin",
    });
  });

  it("redirects to a validated next path (deep-linking, e.g. a join invite)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-3", email: "x@example.com", user_metadata: {} } },
      error: null,
    });

    const res = await GET(callbackRequest(`?code=abc&next=${encodeURIComponent("/join/ABC123")}`));

    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/join/ABC123");
  });

  it("ignores an unsafe next (open-redirect attempt) and falls back to /home", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-4", email: "y@example.com", user_metadata: {} } },
      error: null,
    });

    const res = await GET(callbackRequest(`?code=abc&next=${encodeURIComponent("https://evil.com")}`));

    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/home");
  });

  it("with no guest cookie: never touches guest conversion", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-5", email: "noguest@example.com", user_metadata: {} } },
      error: null,
    });
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-5", email: "noguest@example.com", displayName: null });

    await GET(callbackRequest("?code=abc"));

    expect(getGuestUserId).not.toHaveBeenCalled();
    expect(convertGuestOnAuth).not.toHaveBeenCalled();
  });

  it("with a guest cookie that resolves: converts and clears the cookie", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-6", email: "guest@example.com", user_metadata: {} } },
      error: null,
    });
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-6", email: "guest@example.com", displayName: null });
    getGuestUserId.mockReturnValue("guest-user-id");

    const res = await GET(callbackRequest("?code=abc", { [GUEST_COOKIE]: "raw-guest-token" }));

    expect(getGuestUserId).toHaveBeenCalledWith({}, "raw-guest-token");
    expect(convertGuestOnAuth).toHaveBeenCalledWith({}, "guest-user-id", "resolved-6");
    expect(res.cookies.get(GUEST_COOKIE)?.value).toBe("");
  });

  it("routes a fresh sign-up whose name is still the email local-part through /welcome/name", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-name", email: "pete@example.com", user_metadata: {} } },
      error: null,
    });
    // deriveDisplayName seeds the local-part; displayNameLooksDerived is true.
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-name", email: "pete@example.com", displayName: "pete" });

    const res = await GET(callbackRequest("?code=abc"));

    expect(res.headers.get("location")).toBe(
      `https://cuatro.fly.dev/welcome/name?next=${encodeURIComponent("/home")}`,
    );
  });

  it("a second user on the same device (their id not in the prompted cookie) is still routed through /welcome/name", async () => {
    // The prompted cookie already records a DIFFERENT account (the first
    // sign-up on this device). Because the flag is account-scoped, the new
    // derived-name user must still get the step — the device-scoped bug was
    // that this cookie silently skipped them.
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-second", email: "dana@example.com", user_metadata: {} } },
      error: null,
    });
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-second", email: "dana@example.com", displayName: "dana" });

    const res = await GET(callbackRequest("?code=abc", { cuatro_named: "resolved-first" }));

    expect(res.headers.get("location")).toBe(
      `https://cuatro.fly.dev/welcome/name?next=${encodeURIComponent("/home")}`,
    );
  });

  it("a returning user whose id IS in the prompted cookie skips the step (even with a still-derived name)", async () => {
    // Same-account-same-device: they saw the step once (chose to skip, so the
    // name is still derived). The account's id is in the cookie, so we never
    // re-prompt — the never-nag-twice guarantee, now keyed on the account.
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-return", email: "sam@example.com", user_metadata: {} } },
      error: null,
    });
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-return", email: "sam@example.com", displayName: "sam" });

    const res = await GET(
      callbackRequest("?code=abc", { cuatro_named: "resolved-other,resolved-return" }),
    );

    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/home");
  });

  it("a converting guest's carried name suppresses the /welcome/name step (F6 conversion fix)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-carry", email: "pete@example.com", user_metadata: {} } },
      error: null,
    });
    // The freshly provisioned account is still on the derived name "pete"...
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-carry", email: "pete@example.com", displayName: "pete" });
    getGuestUserId.mockReturnValue("guest-user-id");
    // ...but conversion carries the guest's chosen "Pete" onto it, so the
    // name-step decision must run against "Pete" (not derived) and skip.
    convertGuestOnAuth.mockReturnValue({ converted: true, merged: true, carriedName: "Pete" });

    const res = await GET(callbackRequest("?code=abc", { [GUEST_COOKIE]: "raw-guest-token" }));

    expect(convertGuestOnAuth).toHaveBeenCalledWith({}, "guest-user-id", "resolved-carry");
    expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/home");
    expect(res.cookies.get(GUEST_COOKIE)?.value).toBe("");
  });

  it("with a guest cookie that no longer resolves (already converted elsewhere): skips conversion but still clears the cookie", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "sb-7", email: "stale@example.com", user_metadata: {} } },
      error: null,
    });
    findOrCreateUserBySupabase.mockResolvedValue({ id: "resolved-7", email: "stale@example.com", displayName: null });
    getGuestUserId.mockReturnValue(null);

    const res = await GET(callbackRequest("?code=abc", { [GUEST_COOKIE]: "stale-token" }));

    expect(convertGuestOnAuth).not.toHaveBeenCalled();
    expect(res.cookies.get(GUEST_COOKIE)?.value).toBe("");
  });
});
