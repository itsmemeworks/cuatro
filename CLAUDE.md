# CUATRO — agent context

Consumer social padel app: "the app your padel four runs on." Anti-Playtomic positioning (warm, transparent, no fees/ads/dark patterns). The **Glass** rating (1.00–7.00, transparent, append-only Ledger) is the product's crown jewel. Live: **https://cuatro.fly.dev** (Fly app `cuatro`, lhr).

## Documents (read the one relevant to your task)
- `../DESIGN.md` — product spec: named mechanics (Glass, Circles, Standing Game, Fourth Call, Reliability, The Tab), economics, scope
- `design/CUATRO-Prototype-LATEST.dc.html` — **THE authoritative design** (interactive; serve `design/` via `python3 -m http.server 8791`, needs `support.js` beside it). `design/HANDOFF.md` = tokens/motion/copy rules. If Pete updates the design, re-import the ROOT files of claude.ai/design project `d4c9ef74-8e91-418e-8a4b-a50456cdad88` (the `?file=` param names the authoritative file — NOT the handoff bundle copies).
- `DESIGN-AUDIT.md` — the design-fidelity defect taxonomy + verification bar
- `E2E-CHARTER.md` — the functional/realtime/multi-user test bar
- `../RESEARCH.md` — market research (why we're building this)

## Architecture
npm-workspaces monorepo:
- `packages/glass` — pure rating engine, ZERO runtime deps, exhaustive tests incl. 10k-match convergence sim. Consume its exports (constants, fixtureKey, math); never reimplement its rules.
- `packages/db` — drizzle + better-sqlite3. **SQLite on the Fly volume is the system of record** (`DATABASE_PATH`, prod `/data/cuatro.db`). Migrations run at boot via `createClient()` **with foreign_keys OFF + foreign_key_check after** (SQLite table-recreates fail otherwise on data-bearing DBs — this once 500'd all of prod).
- `apps/web` — Next.js 16 PWA. **Webpack builds, NOT Turbopack** (`next build --webpack`): `extensionAlias` is needed for @cuatro/db's NodeNext imports and is webpack-only. 448px centered phone-frame column is enforced at the root layout — the design is a phone experience.
- **Supabase = auth + realtime ONLY** (project `piaeeuyqqbtmbuqfkfun`, Stockholm). Data never lives there. `supabase/config.toml` is the source of truth for auth config — edit it and run `supabase config push` (never the dashboard).
- **Geo discovery is venue-anchored, NEVER device GPS**: shared layer is `lib/geo.ts` (pure math + `GLASS_BAND`/`DEFAULT_RADIUS_KM`), `server/geocode.ts` (postcodes.io, cache lat/lng on the venue row; backfill = `npx tsx src/server/geocode.ts`), `server/patch.ts` (`resolvePatch`: home venue → explicit patch → inferred). Discovery is on-by-default (`users.findable`) but only active once a patch resolves; queries must exclude guests + unpinned venues themselves.

## Hard conventions (violations have bitten us — don't)
1. **better-sqlite3 transactions are SYNCHRONOUS**: no `await` inside `db.transaction()` callbacks — an async callback commits before awaited writes run.
2. **Realtime emits fire AFTER the transaction commits**, never inside. Server-side emits use the **REST broadcast endpoint** (`/realtime/v1/api/broadcast`, apikey+bearer) — the websocket join dance times out against cold Supabase tenants. Client-side subscriptions stay websocket (`lib/realtime/hooks.ts`). Payloads are minimal signals ({type, ids, ts}) — clients refetch via authed API; never put entity data on the wire.
3. **Notifications go through `server/notify.ts` only** — typed inputs, copy rules: title=what, body=why, NO exclamation marks, never nag twice.
4. **Money = `amount_minor` INTEGER + `currency`** everywhere; splits use floor-per-debtor, payer absorbs remainder (see `tab.ts`); currencies never net against each other. CUATRO never holds funds.
5. **World-ready**: country/timezone as data, UTC epoch-ms timestamps, i18n-able strings, no UK hardcoding.
6. **The Ledger (`rating_events`) is append-only** — never update/delete; users.rating stays NULL until 3 verified matches (hidden internal rating lives in rating_events.ratingAfter).
7. Design system: tokens in `globals.css` + `components/ui/` only; **one coral action per screen**; facts/metadata in IBM Plex Mono (`Meta`/`Fact`); dashed coral circle = "a space waiting for a person" (ONLY that — not progress).
8. Guests are first-class `users` rows (nullable email, `is_guest`); conversion happens at auth callback via the guest cookie.
9. **Raw error codes never reach the UI** — pass server errors through `lib/error-copy.ts` `errorCopy()` (or a page-local map for context-specific codes).
10. **Branded-mechanic explanations live in one place**: `components/ui/info-term.tsx` `GLOSSARY` (+ `<InfoTerm>` dotted-underline → bottom-sheet). Add new mechanic copy there, not inline. NB: "Reliability" = attendance, "confidence" = rating certainty — Playtomic users conflate these; keep the disambiguation.
11. New sign-ups with an email-derived display name route through `/welcome/name` once (cookie `cuatro_named`); OAuth buttons render only when `NEXT_PUBLIC_OAUTH_APPLE/GOOGLE=1` (fly.toml build args) — enable when the parked provider credentials go live.
12. QR codes use the vendored zero-dep encoder in `lib/qr/` (verified bit-for-bit vs the `qrcode` npm pkg) — don't add a QR dependency. QRs render dark-on-light regardless of theme (inverted codes fail on some scanners).
13. Match results record who PLAYED, not who RSVP'd (roster editable at /matches/new; guests minted inside the recording transaction); seal = any real member of a team confirms for it; an all-guest team leaves the match pending, never fake-verified.

## Dev environment
- Local Supabase stack on **544xx ports** (543xx is held by apex's stack): API 54421, Studio 54423, **Mailpit 54424** (captures ALL auth emails — magic links are E2E-testable). `supabase start` from repo root.
- Dev server: `npm run dev` in apps/web (:3000). Seed: `DATABASE_PATH=... npm run seed --workspace=@cuatro/db`.
- **Testing auth without a browser**: set `AUTH_LEGACY=1` in `apps/web/.env.local`, then `POST /api/auth/request {email}` and grep the dev log for the verify link; curl it with a cookie jar. (Never enable AUTH_LEGACY in prod except transiently for smoke tests — unset after.)
- Tests: `npm test` from root (all workspaces, ~411). Build: `npm run build`. No eslint configured — `tsc --noEmit` is the lint bar.
- Chrome MCP quirk: another extension sometimes blocks clicks/typing ("chrome-extension:// URL of different extension") — use `form_input`, JS-dispatched events, or pure-navigation flows instead.

## Deploy (Fly app `cuatro`)
- `fly deploy --ha=false` from repo root (root Dockerfile builds glass dist first; migrations COPY'd explicitly — Next tracing misses .sql; `CUATRO_DB_MIGRATIONS_PATH` env pins them).
- Machine runs **always-warm** (min 1, autostop off) — cold starts read as "site doesn't load".
- `entrypoint.mjs` chowns `/data` then drops root. `AVATAR_DIR=/data/avatars` (image fs is unwritable at runtime).
- Secrets: `FOURTH_CALL_LINK_SECRET` (ring-3 HMAC links). NEXT_PUBLIC_* are baked at BUILD time (fly.toml [build.args]).
- **Before deploying schema changes**: `fly ssh sftp get /data/cuatro.db` and apply migrations to the copy locally — unauthenticated smoke checks do NOT exercise the DB and will lie to you.
- Prod debugging: `fly logs -a cuatro`; a user-visible "server error" with clean health checks usually means a DB-touching path is failing while health (no DB) passes.

## Verification bar (non-negotiable, learned the hard way)
- **Design claims require visual proof**: screenshot at phone width vs the LATEST prototype. Agents self-certifying design accuracy without screenshots have been wrong before (an entire wave shipped the wrong nav IA).
- Functional claims require driving the real app (curl session or browser), not just green units. Realtime claims require a genuinely separate subscriber observing the event live.

## Knowledge maintenance rules (for every agent, every session)
1. **This file is the canonical repo context.** If your work changes anything stated here — architecture, conventions, env, ports, deploy shape, commands — update this file IN THE SAME commit. Keep edits surgical.
2. **New durable gotcha** (cost >15 min, likely to recur) → add ONE line to the relevant section. Not session trivia, not fix logs — git history holds those.
3. **Design changes**: re-import from the claude.ai/design project root, save as `design/CUATRO-Prototype-LATEST.dc.html` (supersede, don't fork names), and note the delta in DESIGN-AUDIT.md.
4. **Keep it under ~120 lines**: when adding, prune anything stale or derivable from code. This file must stay readable in one sitting.
5. **Don't duplicate the spec/docs** — link to them. This file is for what code and docs DON'T say.
6. Parked items live in one place — the "Parked" list below. Check it before proposing "new" work.

## Parked (deliberately not done — don't resurrect without Pete)
- Custom SMTP (prod magic-link email = Supabase built-in: team-members-only + rate-limited — replace before external users)
- Google/Apple OAuth provider credentials (code is ready; enable via config.toml + config push)
- Threaded 💬 beyond the existing per-result comments; "viewing" presence beyond Fourth Call; Cuatro Plus monetisation (v1 spec §1)
