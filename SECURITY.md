# Security policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue for anything
that could put a user or their data at risk.

Use GitHub's private vulnerability reporting: go to the **Security** tab of this
repository and choose **Report a vulnerability**. This opens a private advisory
visible only to the maintainers.

We will acknowledge your report, work with you on a fix, and credit you once a
patch has shipped, if you would like to be credited.

## In scope

- The CUATRO web app in `apps/web` (auth flows, session handling, API routes,
  the guest and invite-link surfaces, the Fourth Call ring-3 HMAC claim links).
- The database layer in `packages/db` and the Glass engine in `packages/glass`.
- Anything that could expose another user's data, let one user act as another,
  or move a rating, a result or a Tab balance without authorisation.

## Out of scope

- The hosted Supabase anon key, the Supabase project reference and the Fly app
  name that appear in `fly.toml`. These are public by design (the anon key is a
  client key gated by row-level policies, not a secret). Reporting them as a leak
  is not a valid finding.
- Denial-of-service through raw request volume.
- Findings that require a compromised device or a malicious browser extension.

## No bounty

There is no paid bug bounty. We are grateful for responsible disclosure and will
happily credit you.
