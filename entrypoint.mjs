#!/usr/bin/env node
// Runs as root (the image's default user) so it can fix ownership of the
// Fly volume mounted at /data — Fly creates that mount root:root, and the
// app itself runs as an unprivileged user. Chown it, then permanently drop
// to that user via process.setuid/setgid before importing the real server,
// so nothing app-level ever executes as root.
//
// The /data volume now holds ONLY user-uploaded avatars (AVATAR_DIR=
// /data/avatars). The database is no longer on the volume — it lives in the
// env's Supabase Postgres, reached via the DATABASE_URL secret.
import fs from "node:fs";

const APP_UID = 1001;
const APP_GID = 1001;
const dataDir = process.env.DATA_DIR ?? "/data";

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.chownSync(dataDir, APP_UID, APP_GID);
} catch (err) {
  console.warn(`[entrypoint] could not prepare ${dataDir}:`, err instanceof Error ? err.message : err);
}

// Next's image optimizer writes its disk LRU cache under the app's
// .next/cache at runtime. The image fs is root-owned and we drop privileges
// below, so without this the first /_next/image request throws an unhandled
// EACCES (Sentry CUATRO-5) — avatars render through next/image, so that's a
// real user path, not scanner noise. Standalone output nests the server
// under apps/web (see the Dockerfile COPY notes).
const nextCacheDir = "/app/apps/web/.next/cache";
try {
  fs.mkdirSync(nextCacheDir, { recursive: true });
  fs.chownSync(nextCacheDir, APP_UID, APP_GID);
} catch (err) {
  console.warn(`[entrypoint] could not prepare ${nextCacheDir}:`, err instanceof Error ? err.message : err);
}

process.setgid(APP_GID);
process.setuid(APP_UID);

await import("./apps/web/server.js");
