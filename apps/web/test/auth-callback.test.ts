import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";

/**
 * /auth/callback is now the universal-link BROWSER FALLBACK only — Supabase's
 * magic-link/OAuth redirect lands here, but real login happens in the native
 * iOS app (it intercepts the universal link before this route is ever hit).
 * No exchange, no provisioning, no guest conversion, no DB access: see the
 * route's own header comment for why. These tests lock in the security
 * properties the brief calls for, not app behaviour (there isn't any).
 */
describe("GET /auth/callback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responds 200 with the exact required headers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("never reads the code query param (the handler takes no request at all)", () => {
    // GET() takes zero arguments — there is no NextRequest to read a `code`
    // from, which is the strongest possible guarantee it's never touched.
    expect(GET.length).toBe(0);
  });

  it("only launches the custom scheme from the button's click handler", async () => {
    const html = await (await GET()).text();
    expect(html).toContain('addEventListener("click"');
    expect(html).toContain("window.location.href = target");
  });

  it("defaults to the cuatro-beta scheme and carries location.search + location.hash", async () => {
    const html = await (await GET()).text();
    expect(html).toContain('"cuatro-beta"');
    expect(html).toContain("window.location.search");
    expect(html).toContain("window.location.hash");
  });

  it("uses CUATRO_URL_SCHEME when set (prod flips scheme via config, not code)", async () => {
    vi.stubEnv("CUATRO_URL_SCHEME", "cuatro");
    const html = await (await GET()).text();
    expect(html).toContain('"cuatro"');
    expect(html).not.toContain('"cuatro-beta"');
  });

  it("shows a TestFlight link when CUATRO_TESTFLIGHT_URL is set, else a private-beta note", async () => {
    vi.stubEnv("CUATRO_TESTFLIGHT_URL", "");
    const withoutUrl = await (await GET()).text();
    expect(withoutUrl).toContain("Private beta opening soon");
    expect(withoutUrl).not.toContain("<a ");

    vi.stubEnv("CUATRO_TESTFLIGHT_URL", "https://testflight.apple.com/join/abc123");
    const withUrl = await (await GET()).text();
    expect(withUrl).toContain('href="https://testflight.apple.com/join/abc123"');
    expect(withUrl).toContain("Get the TestFlight beta");
  });

  it("escapes the TestFlight URL so it can't break out of the href attribute", async () => {
    vi.stubEnv("CUATRO_TESTFLIGHT_URL", 'https://example.com/"><script>alert(1)</script>');
    const html = await (await GET()).text();
    expect(html).not.toContain('"><script>');
  });
});
