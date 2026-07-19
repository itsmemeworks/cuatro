/**
 * Apple App Site Association document. Served byte-identical at both
 * /.well-known/apple-app-site-association and /apple-app-site-association
 * (iOS tries the well-known path first, falls back to the bare path) — a
 * single shared constant is the only way to guarantee that. Team ID
 * N5GGJF75LB, three real bundle IDs (dev/beta/prod), no `.staging` (that
 * bundle ID belongs to an abandoned Apple account and must never appear
 * here). Apple's spec forbids a `.json` extension and any HTML wrapper.
 */
export const AASA_DOCUMENT = {
  applinks: {
    details: [
      {
        appIDs: [
          "N5GGJF75LB.com.itsmemeworks.cuatro.dev",
          "N5GGJF75LB.com.itsmemeworks.cuatro.beta",
          "N5GGJF75LB.com.itsmemeworks.cuatro",
        ],
        components: [
          { "/": "/auth/callback", comment: "Supabase PKCE callback" },
          { "/": "/s/*", comment: "Opaque Cuatro share links" },
          { "/": "/g/*", comment: "Legacy game links during beta" },
          { "/": "/p/*", comment: "Legacy player links during beta" },
          { "/": "/c/*", comment: "Legacy Circle links during beta" },
          { "/": "/r/*", comment: "Legacy sealed-result links during beta" },
        ],
      },
    ],
  },
} as const;
