# syntax=docker/dockerfile:1
#
# Root-context build for the CUATRO monorepo (npm workspaces). apps/web
# depends on the real workspace packages @cuatro/db and @cuatro/glass, so
# this must be built with the monorepo root as the Docker build context
# (`fly deploy` / `docker build` run from here, not from apps/web).

FROM node:22-slim AS deps
WORKDIR /app
# python3/make/g++ are needed if better-sqlite3 has to compile from source
# (no prebuilt binary for this platform/node combo).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Only the manifests, so `npm ci` is cached independently of source changes.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/glass/package.json ./packages/glass/package.json
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# @cuatro/glass's package.json points main/types at dist/, which only
# exists after this tsc build — must run before the Next build below.
RUN npm run build --workspace=@cuatro/glass
# @cuatro/db is consumed as TS source directly (transpilePackages handles
# it), so it needs no separate build step.
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/data/cuatro.db
# Explicit, guaranteed-correct migrations path — see packages/db/src/client.ts
# for why this can't just be inferred at runtime once Next bundles the
# package (import.meta.url gets baked to the build-time source path, and
# standalone's server.js chdir()s before this module even loads).
ENV CUATRO_DB_MIGRATIONS_PATH=/app/packages/db/migrations
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone output for a monorepo nests the server under
# apps/<name>/server.js and only includes what its file tracing found —
# copy static assets, public files, and drizzle's *.sql migrations
# (data files tracing does not reliably pick up) explicitly on top.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations
COPY entrypoint.mjs ./entrypoint.mjs

# Stays root here deliberately: entrypoint.mjs chowns the /data volume
# mount (which Fly creates as root:root) then drops to uid/gid 1001 via
# process.setuid/setgid before importing the actual server — the app code
# itself never runs as root.
EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
