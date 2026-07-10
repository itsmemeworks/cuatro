# CUATRO — agent context

Consumer social padel app: "the app your padel four runs on." Anti-Playtomic positioning (warm, transparent, no fees/ads/dark patterns). The **Glass** rating (1.00–7.00, transparent, append-only Ledger) is the product's crown jewel. Live: **https://padelcuatro.com** (Fly app `cuatro`, lhr; cuatro.fly.dev = same app, kept as the dev-facing URL).

## Documents (read the one relevant to your task)
- `../DESIGN.md` — product spec: named mechanics (Glass, Circles, Standing Game, Fourth Call, Reliability, The Tab), economics, scope
- `design/CUATRO-Prototype-LATEST.dc.html` — **THE authoritative design** (interactive; serve `design/` via `python3 -m http.server 8791`, needs `support.js` beside it). `design/HANDOFF.md` = tokens/motion/copy rules. If Pete updates the design, re-import the ROOT files of claude.ai/design project `d4c9ef74-8e91-418e-8a4b-a50456cdad88` (the `?file=` param names the authoritative file — NOT the handoff bundle copies).
- `DESIGN-AUDIT.md` — the design-fidelity defect taxonomy + verification bar
- `E2E-CHARTER.md` — the functional/realtime/multi-user test bar
- `../RESEARCH.md` — market research (why we're building this)

## Architecture
npm-workspaces monorepo:
- `packages/glass` — pure rating engine, ZERO runtime deps, exhaustive tests incl. 10k-match convergence sim. Consume its exports (constants, fixtureKey, math); never reimplement its rules.
- `packages/db` — drizzle + postgres-js. **Each environment's own Supabase Postgres is the system of record** (`DATABASE_URL`, a Fly secret in deploys; the local Supabase stack's Postgres in dev). Migrations run at boot via `createClient()` (now async) under a `pg_advisory_lock` so concurrent/rolling boots can't race the schema. Tests run against in-memory PGlite via `createTestClient()`, NOT a server. There is no data migration from the old SQLite: the volume DB is gone.
- `apps/web` — Next.js 16 PWA. **Webpack builds, NOT Turbopack** (`next build --webpack`): `extensionAlias` is needed for @cuatro/db's NodeNext imports and is webpack-only. 448px centered phone-frame column is enforced at the root layout — the design is a phone experience.
  - **Entry routing (2026-07-10): `/` serves the MARKETING site, not the app.** The root route handler (`app/route.ts`) returns the self-contained landing page from `public/landing/index.html`, rewriting its canonical padelcuatro.com links/copy/QR to the REQUEST's origin (`lib/landing.ts`) so staging/dev landings never link into prod — the FILE stays canonical for the cuatro-site mirror (assets in `public/landing/img/`, referenced as absolute `/landing/…`; it bypasses the phone-frame layout by being a Route Handler). Auth entry is `/login` (renders `OnboardingWelcome`; signed-in → `/home`); every `(app)` bounce and auth-callback error already targets `/login`. PWA `manifest.json` `start_url=/home`, `scope=/`. The marketing copy is mirrored (byte-identical bar the asset prefix) in `../cuatro-site/` — keep both in sync; see its README.
- **Supabase = the Postgres database + auth + realtime**, one isolated project per environment (own `DATABASE_URL`). The app-facing data now DOES live in that Postgres (this changed with the SQLite→Postgres conversion); realtime still carries minimal signals only. `supabase/config.toml` is the source of truth for auth config — edit it and run `supabase config push` (never the dashboard).
- **Geo discovery is venue-anchored, NEVER device GPS**: shared layer is `lib/geo.ts` (pure math + `GLASS_BAND`/`DEFAULT_RADIUS_KM`), `server/geocode.ts` (postcodes.io, cache lat/lng on the venue row; backfill = `npx tsx src/server/geocode.ts`), `server/patch.ts` (`resolvePatch`: home venue → explicit patch → inferred). Discovery is on-by-default (`users.findable`) but only active once a patch resolves; queries must exclude guests + unpinned venues themselves.

## Hard conventions (violations have bitten us — don't)
1. **Transactions are ASYNC and every read-decide-write MUST lock its anchoring row.** `await db.transaction(async (tx) => { ... })`; awaits inside the callback are correct and required. Postgres MVCC does not serialize writers the way better-sqlite3 did, so any check-then-write (RSVP capacity, reserve promotion, Fourth Call holds/claims, rotation picks, tab settle double-confirm, match seal) MUST take `SELECT ... FOR UPDATE` (drizzle `.for('update')`) on the parent row (session/circle/tab) before deciding. When in doubt, lock the parent row. Realtime emits still fire AFTER commit only (see #2, unchanged and sacred).
2. **Realtime emits fire AFTER the transaction commits**, never inside. Server-side emits use the **REST broadcast endpoint** (`/realtime/v1/api/broadcast`, apikey+bearer) — the websocket join dance times out against cold Supabase tenants. Client-side subscriptions stay websocket (`lib/realtime/hooks.ts`). Payloads are minimal signals ({type, ids, ts}) — clients refetch via authed API; never put entity data on the wire.
3. **Notifications go through `server/notify.ts` only** — typed inputs, copy rules: title=what, body=why, NO exclamation marks, never nag twice.
3b. **Copy style (Pete, 2026-07-09): NO em dashes in user-facing copy** (use a comma, a period, or restructure), no exclamation marks anywhere, lightly humorous with real padel lingo where it fits (see `../research/padel-humour-kit` when it lands; never joke at a specific user, their level, or money owed).
4. **Money = `amount_minor` INTEGER + `currency`** everywhere; splits use floor-per-debtor, payer absorbs remainder (see `tab.ts`); currencies never net against each other. CUATRO never holds funds.
5. **World-ready**: country/timezone as data, UTC epoch-ms timestamps, i18n-able strings, no UK hardcoding.
6. **The Ledger (`rating_events`) is append-only** — never update/delete; users.rating stays NULL until 3 verified matches (hidden internal rating lives in rating_events.ratingAfter).
7. Design system: tokens in `globals.css` + `components/ui/` only; **one coral action per screen**; facts/metadata in IBM Plex Mono (`Meta`/`Fact`); dashed coral circle = "a space waiting for a person" (ONLY that — not progress).
8. Guests are first-class `users` rows (nullable email, `is_guest`); conversion happens at auth callback via the guest cookie.
9. **Raw error codes never reach the UI** — pass server errors through `lib/error-copy.ts` `errorCopy()` (or a page-local map for context-specific codes).
10. **Branded-mechanic explanations live in one place**: `components/ui/info-term.tsx` `GLOSSARY` (+ `<InfoTerm>` dotted-underline → bottom-sheet). Add new mechanic copy there, not inline. NB: "Reliability" = attendance, "confidence" = rating certainty — Playtomic users conflate these; keep the disambiguation.
11. New sign-ups with an email-derived display name route through `/welcome/name` once (cookie `cuatro_named`); OAuth buttons render only when `NEXT_PUBLIC_OAUTH_APPLE/GOOGLE=1` (fly.toml build args) — enable when the parked provider credentials go live.
12. QR codes use the vendored zero-dep encoder in `lib/qr/` (verified bit-for-bit vs the `qrcode` npm pkg) — don't add a QR dependency. QRs render dark-on-light regardless of theme (inverted codes fail on some scanners).
13a. **FRIENDLIES**: every game carries `game_type` (circle default → standing game → session → SNAPSHOT onto the match at record time). The rating gate lives in `matches-db.ts` `applyGlassAndPersist` — friendly matches seal normally, count Reliability/streaks/played-with, but never write rating_events. The match snapshot is why the Ledger can explain an unmoved rating; never derive the gate from a live join.
13. Match results record who PLAYED, not who RSVP'd (roster editable at /matches/new; guests minted inside the recording transaction); seal = any real member of a team confirms for it; an all-guest team leaves the match pending, never fake-verified.
14. **React 19 auto-resets `<form action={fn}>` fields when the action resolves.** A form inside a still-mounted Sheet/overlay with uncontrolled fields will visibly revert after save (and a re-save persists the stale default = data loss). Pattern: save-then-close (unmount before the reset) or fully controlled fields — see settings-sheet.tsx.

## Dev environment
- Local Supabase stack on **544xx ports** (543xx is held by apex's stack): API 54421, **Postgres (db) 54422** (also the local system-of-record DB), Studio 54423, **Mailpit 54424** (captures ALL auth emails — magic links are E2E-testable). `supabase start` from repo root.
- Dev server: `npm run dev` in apps/web (:3000). Seed: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npm run seed --workspace=@cuatro/db`.
- **Testing auth without a browser**: set `AUTH_LEGACY=1` in `apps/web/.env.local`, then `POST /api/auth/request {email}` and grep the dev log for the verify link; curl it with a cookie jar. (Never enable AUTH_LEGACY in prod except transiently for smoke tests — unset after.)
- Tests: `npm test` from root (all workspaces, ~411). Build: `npm run build`. No eslint configured — `tsc --noEmit` is the lint bar.
- Chrome MCP quirk: another extension sometimes blocks clicks/typing ("chrome-extension:// URL of different extension") — use `form_input`, JS-dispatched events, or pure-navigation flows instead.

## Environments (strictly isolated — nothing crosses between them)
| Env | URL | Data | Auth/realtime | Notes |
|---|---|---|---|---|
| local | localhost:3000 | local Supabase stack's Postgres (db 54422) | local Supabase stack (544xx) | Mailpit 54424 catches auth emails |
| staging | **cuatro-staging.fly.dev** | own Supabase Postgres (`DATABASE_URL` Fly secret); volume = avatars only | own Supabase project `cmqicxumhmthbuoehoju` (London) | deploy ANY branch: `fly deploy -c fly.staging.toml --ha=false`; ALSO auto-deploys when a release-please release PR merges (release-please.yml `deploy-staging` job, token = repo secret FLY_STAGING_DEPLOY_TOKEN, deploy-scoped to cuatro-staging only); autostops when idle (first hit after sleep takes a few seconds); STAGING badge + noindex are gated on build arg `NEXT_PUBLIC_APP_ENV=staging`; staging auth email = Supabase built-in (team members only) until SMTP lands |
| prod | **padelcuatro.com** (cuatro.fly.dev = same app) | own Supabase Postgres (`DATABASE_URL` Fly secret); volume = avatars only | Supabase `lkdnxrfddlodmjakhikw` (London) | main branch only, after the gate |

`supabase config push` targets the LINKED project (prod). To push auth config to staging: swap site_url/redirects to cuatro-staging.fly.dev in config.toml, `echo cmqicxumhmthbuoehoju > supabase/.temp/project-ref`, push, then RESTORE both (config.toml back to prod values, project-ref back to `lkdnxrfddlodmjakhikw`) — never leave the repo linked to staging. Any push needs `RESEND_API_KEY` exported (config.toml references env(); key lives in ../.env, never committed).

## Deploy (Fly app `cuatro`)
- `fly deploy --ha=false` from repo root (root Dockerfile builds glass dist first; migrations COPY'd explicitly — Next tracing misses .sql; `CUATRO_DB_MIGRATIONS_PATH` env pins them).
- Machine runs **always-warm** (min 1, autostop off) — cold starts read as "site doesn't load". The warmth also carries the **in-process scheduler** (`server/scheduler.ts`, started from `instrumentation.ts`): 60s ticks materialise standing-game sessions and fire rotation locks + ring-1 Fourth Calls without page loads. Sentry = instrumentation files only (no withSentryConfig — protects the webpack extensionAlias config); `/api/health` does a REAL DB read (503 = Supabase unreachable, Fly will restart the machine).
- `entrypoint.mjs` chowns `/data` then drops root. `AVATAR_DIR=/data/avatars` (image fs is unwritable at runtime). The `/data` volume now holds ONLY avatars; the database moved to Supabase Postgres.
- Secrets: `DATABASE_URL` (the env's Supabase Postgres connection string, supavisor SESSION pooler — set with `fly secrets set`, NOT baked), `FOURTH_CALL_LINK_SECRET` (ring-3 HMAC links). NEXT_PUBLIC_* are baked at BUILD time (fly.toml [build.args]).
- **Before deploying schema changes**: rehearse the migrations against a FRESH local Supabase Postgres (`supabase db reset` then a clean `createClient()` boot-migrate, or a scratch DB) — a fresh migrate proves the initial migration applies cleanly. Then deploy to STAGING before prod; boot-migrate runs automatically under the advisory lock. Unauthenticated smoke checks do NOT exercise the DB and will lie to you.
- Prod debugging: `fly logs -a cuatro`; a user-visible "server error" with clean health checks usually means a DB-touching path is failing while health (no DB) passes.
- **Prod domain = padelcuatro.com** (registered at Gandi, DNS on Cloudflare in DNS-only mode — do NOT enable the orange-cloud proxy, Fly terminates TLS). Fly certs on apex+www; Supabase `site_url` + allowlist point at it; landing pages/QR/README updated 2026-07-10. cuatro.fly.dev = same app, dev-facing URL. The landing QR encodes padelcuatro.com/login — regenerate via `lib/qr` if the auth entry ever moves.

## Working agreement (multi-agent sessions — how this repo is actually built)
- **Parallel agents get strictly disjoint FILE territories** (not themes). Each writes a manifest to the session scratchpad (decisions, files, verified journey, risks) and NEVER commits — the session lead reviews, gates, commits, deploys.
- **Single-owner files** (agents never edit; write the exact addition you need into your manifest and the lead applies it): `server/notify.ts`, `components/ui/info-term.tsx` (GLOSSARY), `lib/error-copy.ts` is lead-seeded but agents may add codes ONLY when no other agent is running.
- **The gate** before every deploy: full `npm test` from root + `tsc --noEmit` + `npm run build`; schema changes additionally rehearse the migrations against a FRESH local Supabase Postgres (fresh `createClient()` boot-migrate from an empty DB) and deploy to STAGING before prod.
- **Deploy order**: app (`fly deploy --ha=false` from repo root) THEN the marketing mirror (`../cuatro-site`, app `cuatro-site`). The landing page ships from TWO synced copies: `apps/web/public/landing/` (served at `/`) and `../cuatro-site/public/` — byte-identical bar the asset prefix.
- **GitHub**: https://github.com/itsmemeworks/cuatro (PUBLIC) — gh account `conspirafi` (`gh auth switch -u conspirafi`). Main is protected: NO direct pushes, everything lands via PR with the "Typecheck and test" check green, squash-merged with a Conventional Commit title (release-please cuts the tag + changelog from merged titles; feat/fix bump the version, chore does not).
- **Decision records**: product decisions log = `../CLAUDE.md`; v1.0 cut line + blessed spec deviations = `V1-READINESS.md`; the shared dev server (:3000) + the local Supabase stack's Postgres are SHARED across concurrent agents — never kill/reseed while others run.

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
