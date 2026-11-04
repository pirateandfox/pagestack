# Changelog

## 0.1.0-beta.4 — 2026-11-04

- First npm release as **`@pirateandfox/pagestack`** (`npm install @pirateandfox/pagestack@beta`). The bare `pagestack` is blocked by npm's similarity rule against an unrelated `page-stack`, and the `pagestack` org name was taken; beta.3 was tagged as `@pagestack/astro` but never published. Imports are `@pirateandfox/pagestack` and `@pirateandfox/pagestack/runtime`; the integration is still named `pagestack` and the CLI `pagestack-invite`.

## 0.1.0-beta.2 — 2026-11-03

- Renamed to **PageStack**: package `pagestack`, integration `pagestack`, CLI `pagestack-invite`, imports `pagestack/runtime` and `pagestack/core/*`. No behaviour change.

## 0.1.0-beta.1 — 2026-11-03

First tagged release, extracted from the LCFCC site repo with history.

- Integration: `/edit`, `/edit/login`, `/edit/enroll`, `/edit/preview/*`, `/api/editor/*` routes; static build untouched unless `EDITOR=1`.
- Editor: section tree, schema-driven inspector, inline text editing, image picker + uploads, presets ("Add section"), reorder / duplicate / delete, undo/redo, drafts, page settings.
- Storage: local working tree (dev) or one GitHub commit per save (optional PR), hash check against concurrent saves.
- Auth: passkeys with one-time invite links, stateless HMAC challenges, signed cookie sessions.
- New: `interactiveSelector` option replaces a hard-coded list of host-site class names.
