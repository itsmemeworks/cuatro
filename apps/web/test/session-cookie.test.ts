import { describe, expect, it } from "vitest";
import { buildSessionCookie, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

describe("buildSessionCookie", () => {
  it("shapes a secure, httpOnly, site-wide cookie for the given token", () => {
    const cookie = buildSessionCookie("abc123");

    expect(cookie.name).toBe(SESSION_COOKIE);
    expect(cookie.value).toBe("abc123");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });
});
