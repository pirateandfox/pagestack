# Roadmap

What we plan for the editor, roughly in order. Items move to the CHANGELOG when they ship.
Host sites pin an npm version and bump when they want a new one.

## Now (0.1 betas)

- [x] Extract from the first host site; nothing site-specific left (`interactiveSelector` option).
- [x] Name: **PageStack** (`@pirateandfox/pagestack` on npm, GitHub `pirateandfox/pagestack`; bare `pagestack` and a `@pagestack` org were both unavailable).
- [x] Internal prefix renamed from `ase` (the old name) to `ps` (0.1.0-beta.8).
- [x] **Add / delete page** from `/edit`, drafts and Publish, one dynamic route over `src/content/pages/**/*.json` (`staticPages`).
- [x] Rich-text sanitising on save.
- [x] **Hardening**: login rate limiting, upload validation, resizing and size cap, removing users and passkeys, roles, CSRF and header protection.
- [x] **Cloudflare adapter** runs on workerd locally, against a stand-in for the GitHub API.
- [x] Deploy to a real Worker with a real repo, and sign in with a passkey there (sentiosonics.com, 2026-11).
- [x] **Dev default off**: hosts enable the editor explicitly (`EDITOR=dev astro dev`) so plain `npm run dev` never writes content.

## Next

- [x] **Go live / staging branch** (`github.live`): saves commit to staging, a branch preview shows them, Go live fast-forwards (or merges into) the live branch. Many saves, one production build.
- [ ] **Build coalescing** guidance: GitHub Action with `concurrency: cancel-in-progress` so a burst of saves is one deploy.
- [x] **Change URL**: move + delete + a line in the host's redirects file, one commit.
- [x] **Page templates**: start from a copy of a page, or from host-defined starters.
- [x] **Global content**: `globals` JSON files with their own fields, repeatable rows via the `list` field.
- [x] **Media library screen**.
- [x] **Blog posts**: Markdown collections (frontmatter form + body with live preview).
- [x] A visual body editor: collection items edited on their own page (`previews`).
- [x] Change URL and revisions for collection items.
- [x] Adding blocks from the page (+ and `/`), lists and quotes edited in place.
- [x] Third-party scripts kept out of the block-page preview (`previewScripts`).
- [ ] A group field for nested frontmatter; reading collection fields from the host's Astro schema.
- [x] **Synced patterns**, written to every copy in one commit.
- [x] **Block transforms** and `/` in an empty block.
- [ ] A content security policy that restricts scripts in the editor; hosts' preview scripts need thought first.

## Before 1.0

- [ ] A week of real use of Go live on Sentiosonics.
- [ ] Table editing on the page (tables open the Markdown today).

## Later / ideas

- **Multilingual sites**: sibling documents per locale, a language switcher in the editor.
- Per-field history and "who changed what" from git log.
- Scheduled publish (commit now, merge at a time) via a GitHub Action.
- Image focal point + crop presets.
- Multi-site: one editor deployment, several repos.

## Non-goals

- A database, a hosted service, or anything holding content outside the repo.
- Rendering with anything other than the host site's own Astro components.
- Loading editor code on public pages.
