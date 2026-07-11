# Changelog

## [1.1.0](https://github.com/itsmemeworks/cuatro/compare/v1.0.0...v1.1.0) (2026-07-11)


### Features

* pilot hardening — persistent push subscriptions and public-endpoint rate limits ([#14](https://github.com/itsmemeworks/cuatro/issues/14)) ([cac210c](https://github.com/itsmemeworks/cuatro/commit/cac210c3546addbb0a1b46c965665fad2feed3a5))


### Bug Fixes

* cap the Postgres pool under the session-pooler client limit ([#11](https://github.com/itsmemeworks/cuatro/issues/11)) ([3facada](https://github.com/itsmemeworks/cuatro/commit/3facada993944b253e7609914e97d12639a60b09))
* timezone-deterministic time rendering and fourth-call card gating ([#15](https://github.com/itsmemeworks/cuatro/issues/15)) ([692f101](https://github.com/itsmemeworks/cuatro/commit/692f101235f156783d5d1e2c95fb9eb586ff5072))

## [1.0.0](https://github.com/itsmemeworks/cuatro/compare/v0.1.1...v1.0.0) (2026-07-10)


### ⚠ BREAKING CHANGES

* convert the system of record from SQLite to Supabase Postgres ([#8](https://github.com/itsmemeworks/cuatro/issues/8))

### Features

* add isolated staging environment (cuatro-staging) ([#3](https://github.com/itsmemeworks/cuatro/issues/3)) ([c8dfbc5](https://github.com/itsmemeworks/cuatro/commit/c8dfbc53f30fa28297ffc94297829eb9d1b88109))
* convert the system of record from SQLite to Supabase Postgres ([#8](https://github.com/itsmemeworks/cuatro/issues/8)) ([328c8df](https://github.com/itsmemeworks/cuatro/commit/328c8dff910f39e287d867552730b11bbfcaa351))
* wave 0 finisher — friendlies, circle lifecycle, guest merge, scheduler, sentry, branded email ([#9](https://github.com/itsmemeworks/cuatro/issues/9)) ([0bfe988](https://github.com/itsmemeworks/cuatro/commit/0bfe98891bf580d2681ef72f04e4ee8b51dc25fe))
* wave 2 — pilot metrics, consistency batch, public story ([#10](https://github.com/itsmemeworks/cuatro/issues/10)) ([f5a2130](https://github.com/itsmemeworks/cuatro/commit/f5a2130695d1c4a308159d59e6f9fbcc6e6126e7))


### Bug Fixes

* make the landing page environment-aware ([#5](https://github.com/itsmemeworks/cuatro/issues/5)) ([f893ab1](https://github.com/itsmemeworks/cuatro/commit/f893ab1f6929d9b1955ea1fc5c6484983adbf08e))

## [0.1.1](https://github.com/itsmemeworks/cuatro/compare/cuatro-v0.1.0...cuatro-v0.1.1) (2026-07-10)


### Bug Fixes

* PWA manifest name matches the CUATRO brand lockup ([#1](https://github.com/itsmemeworks/cuatro/issues/1)) ([2cebba4](https://github.com/itsmemeworks/cuatro/commit/2cebba4140ec0d282b44aef593aa775ca191380f))
