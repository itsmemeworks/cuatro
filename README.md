# CUATRO

**The app your padel four runs on.** One short, it finds your fourth. One over, it sorts who sits out.

Built by a padel four in the North East, for padel fours everywhere. CUATRO is free, has no ads, no fees and no dark patterns. It never touches your court money and never holds a penny of it.

Live: **[padelcuatro.com](https://padelcuatro.com)**

> Status: v1.0 candidate. The core loop (circle, standing game, RSVP, Fourth Call, result, seal, Ledger, Tab) runs end to end and is v1.0-quality for a real group today. A short cut-line of items remains before an external pilot, tracked in [V1-READINESS.md](V1-READINESS.md).

<p>
  <img src="apps/web/public/landing/img/screens/circles.webp" alt="A Circle's home screen" width="30%" />
  <img src="apps/web/public/landing/img/screens/session.webp" alt="A Standing Game session" width="30%" />
  <img src="apps/web/public/landing/img/screens/fourth-call.webp" alt="A Fourth Call filling the last slot" width="30%" />
</p>

## Why it exists

Playtomic got a lot of us into padel and books a court well, but the friction starts with everything around the game: a rating nobody can explain, level anxiety by default, a marketplace of strangers when you just want your usual four, and a group chat where plans go to die. CUATRO fixes the part Playtomic never touched, the organising, and inverts the part it is hated for, the rating.

Full product spec: [docs/DESIGN.md](docs/DESIGN.md). Market research lives at [padel-research.fly.dev](https://padel-research.fly.dev).

## The mechanics

- **Glass, and the Ledger.** A 1.00 to 7.00 rating you can see through. It only moves when you play, and every point of movement is written down in plain English and never edited. You start Unrated and play three games first, so there is no questionnaire and no rounding up. The Ledger is the storage model, not a screen bolted on: it is append-only by design. The full methodology, in plain English: [docs/GLASS.md](docs/GLASS.md).
- **Circles.** Your group's home screen: members, chat, history, streaks, rivalries. Join by link or QR, no phone numbers exchanged.
- **The Standing Game.** Your weekly fixture runs itself. It opens the RSVP, holds the four, queues the reserves, and promotes the next person in the moment someone drops.
- **The Rotation.** When your crew is bigger than four, the Rotation picks the fairest four: fewest recent games go on first, whoever sat out last week is due, and every pick shows its reason. No racing for a slot, no polite dance.
- **The Fourth Call.** One spot, filled from the inside out through widening rings: your circle, then people you have played with, then players nearby at your level, then anyone with the link. Closest people first, strangers never, unless you choose it.
- **The Board and the Open Door.** Find open games and new groups near you, anchored to a venue and never your live location.
- **Reliability.** Turning up, or not, is part of the record. A simple attendance badge, kept separate from skill. No fines, no debt-locking.
- **The Tab.** Who owes what, in the open. Court split, running balances, and a one-tap nudge to the debtor's own bank app. Money never moves through us.

## Roadmap and requests

What is coming, and roughly in what order, lives in [ROADMAP.md](ROADMAP.md). If CUATRO should do something it does not, [file a feature request](https://github.com/itsmemeworks/cuatro/issues/new/choose). If it does something wrong, the bug form is behind the same door. We read everything, and a well-argued issue moves the roadmap.

## Stack

- **Next.js 16** PWA, mobile-first and installable from the browser. The app renders in a 448px centered phone-frame column: it is a phone experience.
- **Postgres, with Drizzle.** Each environment's own Supabase Postgres is the system of record, not a cache. `packages/db` owns the schema and client; migrations run at boot under an advisory lock.
- **The Glass engine** (`packages/glass`) is pure TypeScript with zero runtime dependencies, exhaustively tested including a 10k-match convergence simulation.
- **Supabase** provides the Postgres database plus auth and realtime, one isolated project per environment.
- **Fly.io** for hosting (app `cuatro`, region `lhr`), with the machine kept always-warm.

## Quickstart for contributors

Prerequisites: Node 22, npm, and the [Supabase CLI](https://supabase.com/docs/guides/cli) (for the local auth and realtime stack).

```bash
# 1. Install (npm workspaces, from the repo root)
npm ci

# 2. Start the local Supabase stack (Postgres + auth + realtime).
#    CUATRO's stack runs on 544xx ports: API 54421, Studio 54423,
#    Mailpit 54424 (all local auth emails land here), Postgres on db
#    port 54422. This is also the local database.
supabase start

# 3. Configure the web app's environment
cp apps/web/.env.example apps/web/.env.local
#    Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
#    from `supabase status`. DATABASE_URL already points at the local
#    stack's Postgres (postgresql://postgres:postgres@127.0.0.1:54422/postgres).

# 4. Seed the local database with a sample circle, games and players
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npm run seed --workspace=@cuatro/db

# 5. Run the dev server (http://localhost:3000)
npm run dev --workspace=@cuatro/web
```

**Signing in without a browser.** Set `AUTH_LEGACY=1` in `apps/web/.env.local`, then `POST /api/auth/request {email}` and grep the dev log for the verify link. This is a dev-only fallback: leave it unset for the normal flow, where magic-link emails land in Mailpit at http://127.0.0.1:54424.

**Checks before you open a pull request.**

```bash
npm test              # full suite (~626 tests, all workspaces); no Supabase stack needed
npm run build         # production build (webpack, not Turbopack)
```

There is no ESLint config: `tsc --noEmit` is the lint bar. Run it for `apps/web` and each package.

## Architecture map

npm-workspaces monorepo:

| Package | What it is |
|---|---|
| `packages/glass` | `@cuatro/glass`: the Glass rating engine. Pure, deterministic, zero runtime deps. Consume its exports, never reimplement its rules. |
| `packages/db` | `@cuatro/db`: Drizzle schema and Postgres client (postgres-js). Each environment's Supabase Postgres is the system of record; tests run against in-memory PGlite. |
| `apps/web` | `@cuatro/web`: the Next.js 16 PWA. `/` serves the marketing site, `/login` is the auth entry, `/home` is the app. |

Realtime emits fire after the transaction commits and carry minimal signals only; clients refetch through the authed API. Geo discovery is venue-anchored, never device GPS.

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md) — the product spec: named mechanics, economics, scope.
- [docs/GLASS.md](docs/GLASS.md), how Glass works: the principles, the Ledger, and the guarantees.
- [ROADMAP.md](ROADMAP.md), the public roadmap: now, next, later, and the standing promises.
- [CLAUDE.md](CLAUDE.md) — the canonical engineering context: architecture, hard conventions, dev environment, deploy shape.
- [E2E-CHARTER.md](E2E-CHARTER.md) — the functional, realtime and multi-user test bar.
- [V1-READINESS.md](V1-READINESS.md) — honest current state and the cut-line to v1.0.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute, the conventions reviewers enforce, and the verification bar.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first: it covers the dev setup, the hard conventions this codebase enforces, the verification bar, and the conventional-commit format that drives releases. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go through the process in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).
