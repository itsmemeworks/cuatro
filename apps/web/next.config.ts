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
};

export default nextConfig;
