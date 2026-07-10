import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN, transformLandingHtml } from "@/lib/landing";
import { QrCode, Ecc, qrToPath } from "@/lib/qr/svg";

const LANDING_PATH = path.join(__dirname, "..", "public", "landing", "index.html");

describe("transformLandingHtml", () => {
  it("returns the canonical file untouched for the prod origin", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    expect(transformLandingHtml(html, CANONICAL_ORIGIN)).toBe(html);
  });

  it("rewrites links, step copy and the QR for a non-canonical origin", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    const origin = "https://cuatro-staging.fly.dev";
    const out = transformLandingHtml(html, origin);

    expect(out).not.toContain("padelcuatro.com");
    expect(out).toContain(`href="${origin}/login?next=/home"`);
    expect(out).toContain(`content="${origin}"`); // og:url
    expect(out).toContain("Open cuatro-staging.fly.dev/login"); // step copy
    expect(out).toContain('aria-label="QR code linking to cuatro-staging.fly.dev/login"');

    // The QR path must be exactly what the vendored encoder produces for
    // this origin's login URL, not the canonical symbol.
    const expected = qrToPath(QrCode.encodeText(`${origin}/login`, Ecc.MEDIUM, -1), 4);
    expect(out).toContain(`<path d="${expected}"`);
    expect(html).not.toContain(`<path d="${expected}"`);
  });

  it("keeps the asset paths canonical (only origins are rewritten)", async () => {
    const html = await readFile(LANDING_PATH, "utf8");
    const out = transformLandingHtml(html, "http://localhost:3000");
    expect(out).toContain('"/landing/img/');
  });
});
