import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const findOrCreateUserByEmail = vi.fn();
const createMagicLinkToken = vi.fn();
const consumeMagicLinkToken = vi.fn();
const createSession = vi.fn();
const sendMagicLink = vi.fn();

vi.mock("@/lib/auth-store", () => ({
  getAuthStore: vi.fn(async () => ({
    findOrCreateUserByEmail,
    createMagicLinkToken,
    consumeMagicLinkToken,
    createSession,
  })),
}));

vi.mock("@/lib/mailer", () => ({
  getMailer: vi.fn(() => ({ sendMagicLink })),
}));

// setSessionCookie calls next/headers' cookies(), which only works inside a
// real Next.js request — stub it out but keep legacyAuthEnabled (the thing
// actually under test) real, reading the live AUTH_LEGACY env var below.
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, setSessionCookie: vi.fn() };
});

import { POST as requestPOST } from "@/app/api/auth/request/route";
import { GET as verifyGET } from "@/app/api/auth/verify/route";

describe("legacy magic-link routes, gated by AUTH_LEGACY", () => {
  const originalFlag = process.env.AUTH_LEGACY;

  beforeEach(() => {
    findOrCreateUserByEmail.mockReset();
    createMagicLinkToken.mockReset();
    consumeMagicLinkToken.mockReset();
    createSession.mockReset();
    sendMagicLink.mockReset();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTH_LEGACY;
    else process.env.AUTH_LEGACY = originalFlag;
  });

  describe("when AUTH_LEGACY is unset", () => {
    beforeEach(() => {
      delete process.env.AUTH_LEGACY;
    });

    it("404s POST /api/auth/request without touching the auth store", async () => {
      const req = new NextRequest("https://cuatro.fly.dev/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: "player@example.com" }),
      });

      const res = await requestPOST(req);

      expect(res.status).toBe(404);
      expect(findOrCreateUserByEmail).not.toHaveBeenCalled();
    });

    it("404s GET /api/auth/verify without touching the auth store", async () => {
      const req = new NextRequest("https://cuatro.fly.dev/api/auth/verify?token=sometoken");

      const res = await verifyGET(req);

      expect(res.status).toBe(404);
      expect(consumeMagicLinkToken).not.toHaveBeenCalled();
    });
  });

  describe("when AUTH_LEGACY=1", () => {
    beforeEach(() => {
      process.env.AUTH_LEGACY = "1";
    });

    it("processes POST /api/auth/request as before", async () => {
      findOrCreateUserByEmail.mockResolvedValue({
        id: "u1",
        email: "player@example.com",
        displayName: "player",
      });
      createMagicLinkToken.mockResolvedValue("a-raw-token");

      const req = new NextRequest("https://cuatro.fly.dev/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: "player@example.com" }),
      });

      const res = await requestPOST(req);

      expect(res.status).toBe(200);
      expect(findOrCreateUserByEmail).toHaveBeenCalledWith("player@example.com");
      expect(sendMagicLink).toHaveBeenCalledWith(
        "player@example.com",
        expect.stringContaining("a-raw-token")
      );
    });

    it("processes GET /api/auth/verify and redirects to /home on a valid token", async () => {
      consumeMagicLinkToken.mockResolvedValue({ userId: "u1", email: "player@example.com" });
      createSession.mockResolvedValue("a-session-token");

      const req = new NextRequest("https://cuatro.fly.dev/api/auth/verify?token=a-raw-token");

      const res = await verifyGET(req);

      expect(consumeMagicLinkToken).toHaveBeenCalledWith("a-raw-token");
      expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/home");
    });

    it("redirects to /login?error=invalid_token when the token doesn't resolve", async () => {
      consumeMagicLinkToken.mockResolvedValue(null);

      const req = new NextRequest("https://cuatro.fly.dev/api/auth/verify?token=bad-token");

      const res = await verifyGET(req);

      expect(res.headers.get("location")).toBe("https://cuatro.fly.dev/login?error=invalid_token");
    });
  });
});
