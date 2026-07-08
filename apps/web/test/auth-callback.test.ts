import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

const exchangeCodeForSession = vi.fn();
const findOrCreateUserBySupabase = vi.fn();

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

function callbackRequest(query: string): NextRequest {
  return new NextRequest(new URL(`https://cuatro.fly.dev/auth/callback${query}`));
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    findOrCreateUserBySupabase.mockReset();
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
});
