# CUATRO v1.0 readiness — synthesis (2026-07-10)

Five parallel audits (journeys, spec, consistency, technical, edges) against build
`93b9708`. Full reports in the session scratchpad; this file is the durable summary.

**Verdict: the product is v1.0-quality for Pete's own group today. It is NOT v1.0
for an external pilot until the cut-line items below are closed.** The core loop
(circle → standing game → RSVP → Fourth Call → result → seal → Ledger → Tab) passed
a live five-persona walkthrough end to end, the copy/design system held across ten
feature waves, and the concurrency model survived adversarial probing.

Already fixed during the review: the one BLOCKER-severity data bug (one match per
session; Reliability >100%) was hotfixed and deployed mid-review (`93b9708`).

## Cut line — must close before declaring v1.0 (external pilot)

**Status (2026-07-10, after the wave 0 finisher):** items 1, 2, 3, 5, 6, 10, 11
and 11a are DONE (item 4 was superseded by the Postgres conversion). What still
gates an external pilot: 7 (pilot instrumentation), 8 (consistency batch), and 9
(the final E2E smoke against prod, blocked on SMTP going live).

1. AUTH: custom SMTP wired + verified from a genuinely external inbox (the only
   sign-in path currently delivers to Supabase team members only). Needs Pete:
   provider choice + API key. Config path: supabase/config.toml [auth.email.smtp]
   + `supabase config push` + raise [auth.rate_limit] email_sent.
   → **DONE (wave 0 finisher, 2026-07-10):** Resend SMTP wired in
   supabase/config.toml [auth.email.smtp] (RESEND_API_KEY via env()); the lead
   runs `config push` to both projects + external-inbox verification at the gate.
2. HEARTBEAT: a scheduler tick (the machine is always-warm; an in-process
   interval suffices) so T-48h Fourth Calls and RSVP-window-open fire without
   anyone opening the app + VAPID keys set in Fly so web push actually sends.
   → **DONE (wave 0 finisher):** in-process scheduler (server/scheduler.ts,
   started from instrumentation.ts) materialises sessions and fires rotation
   locks + ring-1 Fourth Calls on 60s ticks; VAPID secrets set on both Fly apps;
   push degrades gracefully when unset. 4 scheduler tests green.
3. SEEING IT BREAK: /api/health does a real DB read; Sentry + global error
   boundary (Pete's stack default; currently zero telemetry).
   → **DONE (wave 0 finisher):** /api/health does a real `select 1` (200/503);
   Sentry server/edge/client init via instrumentation files (no
   withSentryConfig, protecting the webpack extensionAlias) + global-error.tsx.
4. LEDGER SAFETY: SUPERSEDED 2026-07-10 by the Postgres conversion (data
   lives in each env's Supabase project; managed backups). Remaining action:
   put the prod project on Supabase Pro before real users (daily backups,
   no free-tier pausing).
5. PRODUCT BUGS (journeys audit):
   - Court cost cannot be added after Standing Game creation (edit drops it
     silently) → the Tab one-tap split becomes permanently unreachable. Fix +
     make the edit path cost-safe.
   - Circle-feed pinned game "I'm in" silently no-ops when the RSVP window is
     closed (session page handles it correctly; feed surface must match).
   - Knock "tap to decide" notification deep-links to the Feed but the accept
     UI lives under Settings.
   - Name-capture step is device-scoped, not account-scoped → 2nd+ sign-up on
     a device skips it and users appear as email prefixes.
   - Editing a Standing Game's day/time strands the already-materialised next
     session on the old slot with no explanation.
   → **DONE (wave 0 finisher):** all five fixed and regression-tested
   (cost-safe edit path, honest closed-window feed feedback, knock deep-link to
   the Settings tab, account-scoped name capture, reschedule moves the
   materialised session and notifies RSVPs). Verified intact through the
   Postgres conversion; touched tests green.
6. CIRCLE LIFECYCLE (edges audit): leave circle, remove member, organiser
   transfer. Without these one inactive organiser permanently orphans a group
   and nobody can ever offboard. (Circle deletion can wait.)
   → **DONE (wave 0 finisher):** leave / remove member / organiser transfer in
   server/circles.ts + the Members tab UI, roster-locked, with future-RSVP
   withdrawal and reserve promotion on leave/remove and a sole-organiser guard.
   16 tests green.
7. DONE 2026-07-10 (PostHog server-side events per pilot/METRICS.md; seal-rate
   filters to competitive; no-ops without POSTHOG_KEY). Was: PILOT
   INSTRUMENTATION: the four §9 kill/pivot metrics are not measurable
   today (zero analytics). Minimum: a metrics query script; better: PostHog.
   → **STILL PENDING (metrics wave):** the finisher wave shipped features but
   wired no analytics. The seal-rate predicate is documented (competitive games
   only; see the FRIENDLIES manifest) for whoever wires PostHog.
8. DONE 2026-07-10 (all items applied; verified tsc-clean; visual pass at the
   E2E phase). Was: CONSISTENCY BATCH (small): played-with GLOSSARY entry + InfoTerm; (app)
   loading.tsx + error.tsx; 3 one-coral violations; loss-tone error in
   nearby-circle-card; "Circle" capitalisation; 2 copy nits (missing space in
   confirm-settled; weekday label on Tab splits).
   → **STILL PENDING (consistency wave):** not touched by the finisher wave.
9. E2E: staging run DONE 2026-07-10 (8 journeys incl. friendly seal with zero
   rating events, lifecycle, guest+email; two reported bugs were disproven in a
   clean browser — extension interference). Prod smoke = the final step of the
   wave-2 ship.
   → **STILL PENDING (final E2E wave):** each finisher manifest lists the
   screens/journeys the E2E phase must drive; blocked on SMTP going live.
10. FRIENDLIES (Pete, 2026-07-10): circles need a way to keep scores without
    moving Glass. Mechanic: a Competitive/Friendly game classification
    (circle default, per-game override). Friendly results record scores,
    attendance, Reliability, streaks and played-with, but write NO rating
    events; Glass and confidence untouched; clearly badged in the UI. The
    §9 seal-rate metric counts competitive games only.
    → **DONE (wave 0 finisher):** game_type snapshot chain (circle default →
    standing game → session → match at record time); the rating gate in
    matches-db.ts applyGlassAndPersist seals friendlies normally, credits
    Reliability, and writes no rating_events. Quiet "Friendly" badge; the
    §9 seal-rate predicate is documented as competitive-only. 6 tests green.
11a. EMAIL DESIGN (Pete, 2026-07-10): the magic-link email is Supabase's
    unstyled default. Build a branded template with react-email components
    (rendered to static HTML with Supabase Go-template vars, wired via
    config.toml [auth.email.template.magic_link] + config push). CUATRO
    look: warm ground, coral action button, mono facts, copy rules apply.
    → **DONE (wave 0 finisher):** branded react-email template
    (packages/emails/src/magic-link.tsx) rendered to
    supabase/templates/magic-link.html and referenced via
    [auth.email.template.magic_link]; {{ .ConfirmationURL }} intact, copy rules
    clean. Lead runs config push at the gate.
11. GUEST HISTORY MERGE (Pete, 2026-07-10, promoted from v1.1): a guest who
    converts or signs in must keep their match history and rating trail.
    Same-row conversion (guest cookie at auth callback) already keeps it;
    the stranding case is a guest claimed into an EXISTING account — merge
    participations and Ledger events. If the account has no rating history,
    adopt the guest trail wholesale; if both have history, design the merge
    honestly (append-only Ledger must never be rewritten).
    → **DONE (wave 0 finisher):** convertGuestOnAuth merges a guest claimed
    into an existing account (matches, memberships, reactions, comments, chat,
    notifications, Tab, reliability counters, and the append-only Ledger by
    user_id only); adopts the guest trail wholesale when the account has no
    history, marks guest events and keeps the account trail live when both do.
    7 new merge tests green.

## Explicitly deferred to v1.1 (recommended)

- Playtomic prior import UI (spec promised; engine support exists, no input).
- Chat replies + emoji reactions (spec says v0; shipped text-only).
- Tab nudge deep-link to payment rails.
- Dispute resolution flow (disputes are currently terminal).
- Rate limiting + ring-3 guest/reserve-queue caps (public-link spam).
- Guest→existing-account conversion carrying Glass history (currently strands).
- Offline fallback + install nudge (PWA is online-only today).
- Perf: matches player-id indexes, app-shell + /games N+1s (bite at league
  scale, not pilot scale). rsvpInCount toggle-pumping fairness fix.
- i18n externalisation (invisible for UK launch).

## Needs Pete's blessing (spec contradictions shipped deliberately)

- Ring-3 public claim links (spec deferred open-strangers to v1; shipped as
  HMAC links — richer than spec but re-opens the deferred trust surface).
- Ring 2 redefinition: played-with + geo Local Ring instead of the spec's
  "members of your other Circles" (better, but spec must be updated).
- Public player profiles incl. full public Ledger (Pete called this).
- DESIGN.md refresh to cover the discovery subsystem + the above.

## What passed clean (no action)

Live five-persona journeys (organiser, invited mate, discovery stranger, game
lifecycle incl. no-show sub, Tab settle back-half); copy rules (0 em dashes,
0 exclamations, 0 raw slugs); empty states; concurrency invariants (RSVP races,
capacity, promotion, holds, double-confirm); invite entropy; HMAC links; secrets
hygiene; identity-from-session; guest cookie scope; append-only Ledger.
