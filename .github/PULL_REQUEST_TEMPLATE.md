<!--
  Title reminder: use a Conventional Commit title, for example
  "feat(rotation): show the reason behind each pick" or
  "fix(tab): keep the court cost on standing-game edit".
  Pull requests are squash-merged and this title feeds the changelog.
-->

## What

<!-- What does this change do? -->

## Why

<!-- What problem does it solve? Link the issue if there is one. -->

## Checklist

- [ ] Title follows Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, ...)
- [ ] `npm test` passes and new behaviour has tests
- [ ] `tsc --noEmit` is clean for the packages I touched
- [ ] Verification bar met: I drove the real app for functional changes, and attached phone-width screenshots for any UI change
- [ ] Copy rules met: no em dashes, no exclamation marks, no raw error codes in the UI
