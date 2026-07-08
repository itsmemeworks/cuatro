# CUATRO

The app your padel four runs on. Spec: `../DESIGN.md` · Research: https://padel-research.fly.dev

## Layout
- `apps/web` — Next.js 16 PWA (mobile-first, SQLite on Fly volume)
- `packages/glass` — `@cuatro/glass`: the Glass rating engine (pure TypeScript, zero deps, Vitest)
- `packages/db` — `@cuatro/db`: Drizzle schema + client (world-ready: country as data, amount_minor+currency, tz per venue)

## Conventions
- npm workspaces; packages are imported by name (`@cuatro/glass`, `@cuatro/db`)
- SQLite file path from `DATABASE_PATH` (defaults to `./dev.db` locally, `/data/cuatro.db` on Fly)
- Deploy: Fly app `cuatro`, region `lhr`
