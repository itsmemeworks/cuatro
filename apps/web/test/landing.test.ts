import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_ORIGIN, applyTestflightCta, transformLandingHtml } from "@/lib/landing";

const LANDING_PATH = path.join(__dirname, "..", "public", "landing", "index.html");

describe("transformLandingHtml", () => {
  it("returns the canonical file untouched for the prod origin", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    expect(transformLandingHtml(html, CANONICAL_ORIGIN)).toBe(html);
  });

  it("rewrites absolute prod links for a non-canonical origin", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    const origin = "https://cuatro-staging.fly.dev";
    const out = transformLandingHtml(html, origin);

    expect(out).not.toContain("padelcuatro.com");
    expect(out).toContain(`content="${origin}"`); // og:url
  });

  it("keeps the asset paths canonical (only the origin is rewritten)", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    const out = transformLandingHtml(html, "http://localhost:3000");
    expect(out).toContain('"/landing/img/');
  });
});

describe("applyTestflightCta", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves both CTA markers to a private-beta note when no TestFlight URL is configured", () => {
    vi.stubEnv("CUATRO_TESTFLIGHT_URL", "");
    const out = applyTestflightCta("<!--TESTFLIGHT_CTA--> and <!--TESTFLIGHT_CTA-->");
    expect(out).not.toContain("TESTFLIGHT_CTA");
    expect(out.match(/private beta opening soon/g)).toHaveLength(2);
  });

  it("resolves both markers to a real link when CUATRO_TESTFLIGHT_URL is set", () => {
    vi.stubEnv("CUATRO_TESTFLIGHT_URL", "https://testflight.apple.com/join/abc123");
    const out = applyTestflightCta("<!--TESTFLIGHT_CTA--> and <!--TESTFLIGHT_CTA-->");
    expect(out).not.toContain("TESTFLIGHT_CTA");
    expect(out.match(/href="https:\/\/testflight\.apple\.com\/join\/abc123"/g)).toHaveLength(2);
    expect(out).toContain("Get the TestFlight beta");
  });

  it("escapes a quote in the URL so it can't break out of the href attribute", () => {
    vi.stubEnv("CUATRO_TESTFLIGHT_URL", 'https://example.com/"><script>alert(1)</script>');
    const out = applyTestflightCta("<!--TESTFLIGHT_CTA-->");
    // The dangerous raw `">` sequence (which would close the attribute then
    // open a real tag) must never appear; the quote is escaped to &quot;
    // instead, so the whole payload stays inert inside the href string.
    expect(out).not.toContain('"><script>');
    expect(out).toContain("&quot;&gt;");
  });
});
