import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
