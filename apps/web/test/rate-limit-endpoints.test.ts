import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

// One integration test per wrapped endpoint category: burst past the cap to
// prove a 429 (with Retry-After) and prove the window reopens once time passes.
// Every downstream dependency is mocked so the happy path returns 200 and only
// the limiter decides the burst outcome. The limiter itself is real (the vitest
// bypass is opt-in via RATE_LIMIT_DISABLED, which we never set here).

// vi.mock factories are hoisted above the module body, so any mock fn a factory
// reads at evaluation time must be created with vi.hoisted to dodge the TDZ.
const m = vi.hoisted(() => ({
  findOrCreateUserByEmail: vi.fn(),
  createMagicLinkToken: vi.fn(),
  sendMagicLink: vi.fn(),
  getSessionUser: vi.fn(),
  claimGuestSlot: vi.fn(),
  getGuestUserId: vi.fn(),
  createSessionKnock: vi.fn(),
}));
const { getSessionUser, findOrCreateUserByEmail, createMagicLinkToken, claimGuestSlot, createSessionKnock } = m;

// --- auth/request deps (legacyAuthEnabled stays real, reads AUTH_LEGACY) ---
vi.mock("@/lib/auth-store", () => ({
  getAuthStore: vi.fn(async () => ({ findOrCreateUserByEmail: m.findOrCreateUserByEmail, createMagicLinkToken: m.createMagicLinkToken })),
}));
vi.mock("@/lib/mailer", () => ({ getMailer: vi.fn(() => ({ sendMagicLink: m.sendMagicLink })) }));

// --- session: keep legacyAuthEnabled real, stub getSessionUser ---
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, getSessionUser: m.getSessionUser };
});

// --- guest / avatar deps ---
vi.mock("@/server/guest", () => ({ claimGuestSlot: m.claimGuestSlot, getGuestUserId: m.getGuestUserId }));
vi.mock("@/lib/guest-session", () => ({
  setGuestCookie: vi.fn(async () => {}),
  getGuestToken: vi.fn(async () => null),
}));
const avatarDbStub = { update: () => ({ set: () => ({ where: async () => {} }) }) };
vi.mock("@/server/games-db", () => ({ getGamesClient: vi.fn(async () => ({ db: avatarDbStub })) }));
vi.mock("@/lib/avatar-storage", () => ({ saveAvatarJpeg: vi.fn() }));

// --- knock deps ---
vi.mock("@/server/discovery", () => ({ createSessionKnock: m.createSessionKnock, withdrawSessionKnock: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: {} })) }));

import { POST as authRequest } from "@/app/api/auth/request/route";
import { POST as guestClaim } from "@/app/api/guest/claim/route";
import { POST as sessionKnock } from "@/app/api/knocks/session/route";
import { POST as avatarUpload } from "@/app/api/avatar/route";

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  __resetRateLimitForTests();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth/request (email flood) — 5 per email / 15min", () => {
  const original = process.env.AUTH_LEGACY;
  beforeEach(() => {
    process.env.AUTH_LEGACY = "1";
    findOrCreateUserByEmail.mockResolvedValue({ id: "u1", email: "p@example.com", displayName: "p" });
    createMagicLinkToken.mockResolvedValue("tok");
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_LEGACY;
    else process.env.AUTH_LEGACY = original;
  });

  it("429s after the burst and 200s again after the window", async () => {
    const make = () =>
      new NextRequest("https://cuatro.fly.dev/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json", "fly-client-ip": "1.1.1.1" },
        body: JSON.stringify({ email: "p@example.com" }),
      });

    for (let i = 0; i < 5; i++) expect((await authRequest(make())).status).toBe(200);

    const denied = await authRequest(make());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await denied.json()).error).toBe("rate_limited");

    vi.setSystemTime(1_000_000 + 15 * 60_000 + 1);
    expect((await authRequest(make())).status).toBe(200);
  });
});

describe("guest endpoints — 30 per IP / 5min", () => {
  beforeEach(() => {
    claimGuestSlot.mockResolvedValue({ ok: true, status: "in", token: "g", holdExpiresAt: new Date(2_000_000) });
  });

  it("429s after the burst and 200s again after the window", async () => {
    const make = () => jsonReq("https://cuatro.fly.dev/api/guest/claim", { sessionId: "s1", token: "t1" }, { "fly-client-ip": "2.2.2.2" });

    for (let i = 0; i < 30; i++) expect((await guestClaim(make())).status).toBe(200);

    const denied = await guestClaim(make());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);

    vi.setSystemTime(1_000_000 + 5 * 60_000 + 1);
    expect((await guestClaim(make())).status).toBe(200);
  });
});

describe("authed knock create — 10 per user / 5min", () => {
  beforeEach(() => {
    getSessionUser.mockResolvedValue({ id: "user-1" });
    createSessionKnock.mockResolvedValue({ ok: true, knock: { id: "k1" } });
  });

  it("429s after the burst and 200s again after the window", async () => {
    const make = () => jsonReq("https://cuatro.fly.dev/api/knocks/session", { sessionId: "s1" });

    for (let i = 0; i < 10; i++) expect((await sessionKnock(make() as never)).status).toBe(200);

    const denied = await sessionKnock(make() as never);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);

    vi.setSystemTime(1_000_000 + 5 * 60_000 + 1);
    expect((await sessionKnock(make() as never)).status).toBe(200);
  });
});

describe("avatar upload — 10 per actor / hour", () => {
  beforeEach(() => {
    getSessionUser.mockResolvedValue({ id: "user-1" });
  });

  it("429s after the burst and 200s again after the window", async () => {
    const make = () => jsonReq("https://cuatro.fly.dev/api/avatar", { dataUrl: "data:image/jpeg;base64,AAAA" });

    for (let i = 0; i < 10; i++) expect((await avatarUpload(make())).status).toBe(200);

    const denied = await avatarUpload(make());
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);

    vi.setSystemTime(1_000_000 + 60 * 60_000 + 1);
    expect((await avatarUpload(make())).status).toBe(200);
  });
});
