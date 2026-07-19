import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Explicit rather than relying on Next's lockfile-based auto-detection —
  // this is an npm workspaces monorepo (root package-lock.json), and
  // @cuatro/db / @cuatro/glass live outside apps/web, so file tracing for
  // the standalone build needs to see the whole monorepo root to pick up
  // their sources (and, for @cuatro/db, its migrations/*.sql files).
  // Next always invokes this config with cwd set to apps/web (this file's
  // own directory), so process.cwd() is a stable anchor — using
  // import.meta.url here trips up Next's config loader when the package is
  // "type": "module" (it compiles next.config.ts to CJS internally).
  outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
  // @cuatro/db and @cuatro/glass are workspace TS packages (NodeNext, .js
  // extensions on .ts imports) — transpile them through Next's bundler
  // rather than requiring a separate build step. extensionAlias tells the
  // bundler that a literal "./foo.js" specifier may resolve to "./foo.ts",
  // which is what makes those NodeNext-style imports resolve at all here.
  // As of Next 16.2.10 this option is webpack-only (no Turbopack equivalent
  // yet), which is why dev/build are pinned to --webpack in package.json.
  transpilePackages: ["@cuatro/db", "@cuatro/glass"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

/**
 * A practical baseline CSP, not a nonce-based strict one — Next injects its
 * own inline hydration scripts on every page and the landing page (a plain
 * static HTML file, not React) uses inline `style="…"` attributes, so
 * script-src/style-src need 'unsafe-inline' or the whole app breaks. This
 * still buys the things actually asked for: no framing (frame-ancestors),
 * no plugin/object embeds, and a locked-down default. Allowances, each tied
 * to a real caller:
 *   - fonts.googleapis.com / fonts.gstatic.com — the landing page's own
 *     <link> Google Fonts (apps/web/public/landing/index.html); the REST of
 *     the app self-hosts fonts via next/font and needs neither.
 *   - *.supabase.co (https + wss) — auth/DB/realtime, one project per env.
 *   - *.fly.storage.tigris.dev + worker-src blob: — the Atlas map (MapLibre
 *     fetches PMTiles over Range requests and runs its own worker from a
 *     Blob URL; flagged as a future CSP requirement when that map shipped).
 *   - *.sentry.io — client-side error reporting (NEXT_PUBLIC_SENTRY_DSN).
 *   - localhost/127.0.0.1 (ws + http), both hostnames, only outside
 *     production — the local Supabase stack, Next's dev-mode HMR socket,
 *     and the local pmtiles dev server (.env.local's NEXT_PUBLIC_TILES_URL
 *     points at http://localhost:8792, not 127.0.0.1 — CSP matches the
 *     literal host string, so both forms need listing).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  [
    "connect-src 'self'",
    "https://*.supabase.co wss://*.supabase.co",
    "https://*.fly.storage.tigris.dev",
    "https://*.sentry.io",
    ...(process.env.NODE_ENV === "production"
      ? []
      : ["ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:*"]),
  ].join(" "),
].join("; ");

export default nextConfig;
