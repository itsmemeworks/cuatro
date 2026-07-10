# Contributing to CUATRO

Thanks for wanting to help build the app padel fours run on. This guide covers
how to get set up, the conventions reviewers will hold you to, and how to get a
change merged.

## Getting set up

Follow the **Quickstart for contributors** in the [README](README.md#quickstart-for-contributors):
install with `npm ci`, start the local Supabase stack with `supabase start`,
copy `apps/web/.env.example` to `apps/web/.env.local`, seed a database, and run
`npm run dev`. The engineering context lives in [CLAUDE.md](CLAUDE.md): read it
before a non-trivial change, it explains the architecture and the reasoning
behind the rules below.

## The verification bar

A change is not done because the types pass. Claims have to be shown.

- **Functional claims require driving the real app.** A green unit test is not
  proof that a flow works. Exercise the path in a browser or with a curl session
  against a running dev server, and say in the pull request what you drove.
- **Design or UI claims require phone-width screenshots.** CUATRO is a 448px
  phone experience. Attach screenshots at phone width. Self-certifying a UI
  change without a screenshot has shipped the wrong thing before.
- **Realtime claims require a genuinely separate subscriber** observing the
  event live, not the same tab that triggered it.

## Hard conventions reviewers enforce

These are load-bearing. Each one has bitten this codebase before. A pull request
that breaks one will be sent back.

1. **better-sqlite3 transactions are synchronous.** No `await` inside a
   `db.transaction()` callback: an async callback commits before the awaited
   writes run.
2. **Realtime emits fire after the transaction commits, never inside it.**
   Server-side emits use the REST broadcast endpoint; payloads are minimal
   signals (`{type, ids, ts}`), never entity data. Clients refetch through the
   authed API.
3. **Notifications go through `server/notify.ts` only.** It is the single owner:
   typed inputs, title says what, body says why, and it never nags twice.
4. **The Ledger (`rating_events`) is append-only.** Never update or delete a
   rating event. A user's rating stays null until three verified matches.
5. **Copy rules.** No em dashes in user-facing copy (use a comma, a period, or
   restructure). No exclamation marks anywhere. Light humour with real padel
   lingo is welcome, but never joke at a specific user, their level, or money
   they owe. This applies to UI strings, notifications and docs alike.
6. **One coral action per screen.** Coral is the single primary action; do not
   put two on one screen.
7. **Raw error codes never reach the UI.** Pass server errors through
   `lib/error-copy.ts` `errorCopy()` (or a context-local map). Users see plain
   English, never a slug.
8. **Branded-mechanic explanations live in one place:** the `GLOSSARY` in
   `components/ui/info-term.tsx`, surfaced with `<InfoTerm>`. Add new mechanic
   copy there, not inline. Keep the Reliability (attendance) versus confidence
   (rating certainty) distinction intact.
9. **Results record who PLAYED, not who RSVP'd.** Guests are minted inside the
   recording transaction; a seal needs a real member of a team to confirm for
   it.
10. **Money is `amount_minor` (integer) plus `currency`,** everywhere. Splits
    floor per debtor and the payer absorbs the remainder. CUATRO never holds
    funds.
11. **React 19 resets `<form action={fn}>` fields when the action resolves.** A
    form inside a still-mounted overlay with uncontrolled fields will revert
    after save. Use save-then-close (unmount before the reset) or fully
    controlled fields. See `settings-sheet.tsx`.

Consume the Glass engine's exports; never reimplement its rules. Geo discovery
is venue-anchored, never device GPS.

## Tests and the lint bar

- Run the full suite before opening a pull request: `npm test` from the repo
  root runs every workspace (around 626 tests). It uses better-sqlite3 and does
  not need the Supabase stack running.
- New behaviour needs tests. Bug fixes should come with a test that fails
  without the fix.
- There is no ESLint config. `tsc --noEmit` is the lint bar: run it for
  `apps/web` and each package and keep it clean.
- `npm run build` must pass (the production build uses webpack, not Turbopack).

## Commits and pull requests

**Conventional Commits are required.** Releases and the changelog are generated
automatically from commit history by release-please, so the format matters.

Use `type(optional-scope): summary`, for example:

```
feat(rotation): show the reason behind each pick
fix(tab): stop the court cost being dropped on standing-game edit
chore(deps): bump next to 16.2.10
docs: clarify the Fourth Call ring order in the README
test(glass): cover echo damping past the third repeat fixture
```

Common types: `feat` (a new feature, minor version bump), `fix` (a bug fix,
patch bump), `docs`, `chore`, `refactor`, `test`, `perf`. A breaking change adds
a `!` after the type or a `BREAKING CHANGE:` footer, which drives a major bump.

Pull requests are **squash-merged**, and the squash title becomes the commit
that release-please reads. Give the pull request a conventional-commit title so
the changelog stays accurate.

### Pull request process

1. Branch from `main`.
2. Make your change with tests, keep the suite and `tsc --noEmit` green.
3. Fill in the pull request template: what and why, confirm tests pass, and meet
   the verification bar (drove the real app, or attached phone-width screenshots
   for UI).
4. A maintainer reviews against the conventions above and merges by squash with
   a conventional-commit title.

## Code of Conduct

Be kind. Participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).
