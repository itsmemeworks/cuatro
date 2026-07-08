import { describe, expect, it } from "vitest";
import { isSafeRelativePath, resolveRequestOrigin } from "@/lib/safe-redirect";

/** Minimal stand-in for the bits of NextRequest resolveRequestOrigin reads. */
function fakeRequest(headers: Record<string, string>, nextUrl = new URL("https://0.0.0.0:3000/api/auth/verify")) {
  return { headers: new Headers(headers), nextUrl };
}

describe("isSafeRelativePath", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeRelativePath("/join/ABC123")).toBe(true);
    expect(isSafeRelativePath("/circles")).toBe(true);
    expect(isSafeRelativePath("/")).toBe(true);
  });

  it("rejects absolute URLs", () => {
    expect(isSafeRelativePath("https://evil.com")).toBe(false);
    expect(isSafeRelativePath("http://evil.com/join/ABC")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeRelativePath("//evil.com")).toBe(false);
    expect(isSafeRelativePath("///evil.com")).toBe(false);
  });

  it("rejects paths without a leading slash", () => {
    expect(isSafeRelativePath("join/ABC123")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });

  it("rejects backslash tricks and control characters", () => {
    expect(isSafeRelativePath("/\\evil.com")).toBe(false);
    expect(isSafeRelativePath("/join/ABC\nSet-Cookie: x=1")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
  });
});

describe("resolveRequestOrigin", () => {
  it("prefers X-Forwarded-Host/Proto over the bind-address nextUrl (the Fly.io production case)", () => {
    const request = fakeRequest({ "x-forwarded-host": "cuatro.fly.dev", "x-forwarded-proto": "https" });
    expect(resolveRequestOrigin(request)).toBe("https://cuatro.fly.dev");
  });

  it("takes the first value when X-Forwarded-Proto is a comma-separated chain", () => {
    const request = fakeRequest({ "x-forwarded-host": "cuatro.fly.dev", "x-forwarded-proto": "https,http" });
    expect(resolveRequestOrigin(request)).toBe("https://cuatro.fly.dev");
  });

  it("falls back to the Host header when there's no X-Forwarded-Host", () => {
    const request = fakeRequest({ host: "cuatro.fly.dev", "x-forwarded-proto": "https" });
    expect(resolveRequestOrigin(request)).toBe("https://cuatro.fly.dev");
  });

  it("assumes https for a non-local host with no X-Forwarded-Proto", () => {
    const request = fakeRequest({ host: "cuatro.fly.dev" });
    expect(resolveRequestOrigin(request)).toBe("https://cuatro.fly.dev");
  });

  it("never trusts nextUrl's bind-address host (0.0.0.0) even with no forwarding headers", () => {
    const request = fakeRequest({}, new URL("https://0.0.0.0:3000/api/auth/verify"));
    expect(resolveRequestOrigin(request)).toBe("http://localhost:3000");
  });

  it("uses nextUrl as a last resort when it's a real, non-bind-address host (plain `next dev`)", () => {
    const request = fakeRequest({}, new URL("http://localhost:3000/api/auth/verify"));
    expect(resolveRequestOrigin(request)).toBe("http://localhost:3000");
  });

  it("treats a forwarded localhost host as http", () => {
    const request = fakeRequest({ "x-forwarded-host": "localhost:3000" });
    expect(resolveRequestOrigin(request)).toBe("http://localhost:3000");
  });
});
