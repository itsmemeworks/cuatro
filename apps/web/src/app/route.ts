import { readFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { applyTestflightCta, transformLandingHtml } from "@/lib/landing";
import { resolveRequestOrigin } from "@/lib/safe-redirect";

/**
 * The domain root now serves the marketing site, not the app (Pete, 2026-07-10:
 * "the website is served off the root of the domain ... then you update the route
 * for the PWA"). The auth entry screen moved to /login (see app/login/page.tsx);
 * the (app) tab group and every auth redirect already target /login.
 *
 * The page is a fully self-contained static file (its assets live under
 * public/landing/img and are referenced with absolute /landing/... URLs, so they
 * resolve the same whether the page is hit at / here or directly at
 * /landing/index.html). We read and return it from a Route Handler rather than a
 * React page so it bypasses the global 448px phone-frame column in app/layout.tsx
 * — Route Handlers don't run through layouts — and renders full-bleed.
 *
 * The canonical copy is apps/web/public/landing/index.html; padel/cuatro-site/
 * mirrors it (see that dir's README). Keep the two in sync when the copy changes.
 *
 * cwd is a stable anchor in both dev (Next runs from apps/web) and prod (Next's
 * standalone server.js does process.chdir(__dirname) → apps/web before app code
 * loads; the Dockerfile COPYs apps/web/public into the image), same reasoning as
 * packages/db/src/client.ts's migrations-path resolution and lib/avatar-storage.ts.
 */
const LANDING_PATH = path.join(process.cwd(), "public", "landing", "index.html");

let cachedHtml: string | null = null;

async function loadLandingHtml(): Promise<string> {
  if (cachedHtml === null) {
    cachedHtml = await readFile(LANDING_PATH, "utf8");
  }
  return cachedHtml;
}

/*
 * The file is written against the canonical prod origin; every other origin
 * (staging, cuatro.fly.dev, local dev) gets its links/copy/QR rewritten to
 * itself so a tester is never silently bounced into prod — see lib/landing.ts.
 * Memoised per origin; the cap only guards against unbounded junk Host
 * headers, real traffic uses a handful of hostnames.
 */
const transformedByOrigin = new Map<string, string>();

export async function GET(request: NextRequest) {
  const base = await loadLandingHtml();
  const origin = resolveRequestOrigin(request);
  let html = transformedByOrigin.get(origin);
  if (html === undefined) {
    // CUATRO_TESTFLIGHT_URL is a process-lifetime constant (a Fly secret,
    // not per-request), so baking it into the same per-origin cache entry
    // as the origin rewrite is safe — nothing here varies within a boot.
    html = applyTestflightCta(transformLandingHtml(base, origin));
    if (transformedByOrigin.size < 8) transformedByOrigin.set(origin, html);
  }
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A short cache with revalidation: the page is static but we redeploy it,
      // so let the CDN/browser hold it briefly and revalidate rather than pin it.
      "cache-control": "public, max-age=0, s-maxage=3600, must-revalidate",
      // Route Handlers bypass layout.tsx metadata, so staging opts out of
      // indexing here too — staging must never compete with padelcuatro.com.
      ...(process.env.NEXT_PUBLIC_APP_ENV === "staging" ? { "x-robots-tag": "noindex, nofollow" } : {}),
    },
  });
}
