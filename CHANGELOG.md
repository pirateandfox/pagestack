# Changelog

## 0.1.0-beta.7 — 2026-11-09

- **Collection items on their own page**: with `previews: { <collection>: './Layout.astro' }`, an item opens in the site's layout and is edited in place: title and fields, paragraphs and headings (back to Markdown, only that block's lines change), images, with Page / Markdown views and Preview in a tab. New runtime export `itemField` and type `ItemPreviewProps`. The frame is sandboxed, so the site's own scripts (analytics, spam checks) don't run in the editor.
- **Uploads show in a deployed editor**: images uploaded or committed after the editor was built were 404s on Workers (the static 404 page answered before any editor code ran). They are now served from the repo to signed-in editors by a route at the uploads URL. Storage adapters gain `asset(path)`.
- Image fields redraw after a pick in the item and global editors (they used to show "No image" until a reload). `altField` on an `asUrl` image field takes the alt text from the picker.
- Passkeys must verify the user (Touch ID, PIN). The request said "preferred" while the check required it, so an authenticator that skipped it was refused with a confusing error.
- The item editor's title is the large heading it was meant to be (an invalid `font` shorthand was ignored).

## 0.1.0-beta.6 — 2026-11-06

- **`pages: false`** for a site with no block pages: `renderer` becomes optional, and the Pages screen and Add page go away.
- **New collection items** start from each field's `default`, so required frontmatter is there. `create: false` on a collection hides Add.
- Prerendered routes skip the middleware, so a build no longer needs `EDITOR_SECRET`.

## 0.1.0-beta.5 — 2026-11-05

A WordPress block-editor user should feel at home. Everything is additive: pages, options, routes, `data-ase-*` and `editor-users.json` keep working unchanged, and a site that adopts none of this builds byte-identically.

- **Pages screen** at `/edit`: search, status, add, copy, delete. Add page takes a title, an auto slug, and a starting point (blank, a copy of a page, or a host template). Slugs are checked for duplicates, reserved paths and the site's own routes. A new page needs the host's catch-all route (see README).
- **Draft / Publish**: optional `status: 'draft'` in the page JSON. Absent means published, so existing pages are unaffected. `staticPages()` (new runtime export) leaves drafts out of the build.
- **Change URL** moves the file and adds a 301 to `public/_redirects` (if that file exists) in one commit. **Revisions** lists the git history of a page; picking one loads it as an undoable draft. **Delete page** removes the file in one commit, so it can be recovered from git.
- **Block inserter**: searchable panel with categories (`category`, `keywords` on a schema) and a Patterns tab. Save any block as a pattern, kept in the repo. `+` between sections, an empty-page prompt, breadcrumbs, a block ⋮ menu, copy/paste across pages, keyboard shortcuts.
- **Document Overview**: List View can move blocks between containers; blocks can also be dragged on the canvas.
- **Rich text**: toolbar and link popover both inline and in the sidebar, with an HTML view. Pasted content is cleaned.
- **Previews**: real device widths (1280 / 1024 / 390) scaled to fit, plus Preview in a new tab that renders the unsaved draft.
- **Global content**: `globals` in the sections module describes JSON files (menus, footer links) edited at `/edit/global/<id>`. New `list` field type for repeatable rows, `asUrl` on image fields.
- **Host hooks**, all optional: `pageFields`, `templates`, `globals` exports; `reservedSlugs`, `redirectsFile`, `patternsFile` options.
- **Security**: every value is cleaned on save, not only rich text: all field types, keys outside the schema, titles, descriptions, `attrs` and Markdown. Unchanged content stays byte-identical. Select, number, boolean and color values are checked against their type. SVG fields and uploads go through an allowlist. Uploads are judged by their bytes, not their claimed type.
- **Roles**: `admin` and `editor` (no `role` in `editor-users.json` means admin). Only admins invite, manage people, and write raw HTML in `code` fields; editors can't damage what an admin put there. Users screen at `/edit/users`: change roles, remove people or single passkeys. The last admin is protected. Removing someone ends their sessions within seconds.
- **Invites** moved from `/edit` to `/edit/users`. Invites from the screen default to Editor; `pagestack-invite` from the CLI creates admins, so you can always get back in.
- **Hardening**: login rate limit (30 attempts per 5 minutes per IP, per server instance; `clientIpHeader` option behind a proxy), cross-site writes refused, security headers on all editor routes, open redirect after login closed, the Preview tab sandboxed away from the session, `none-behind-proxy` refuses requests with no identity in a build (optional `EDITOR_PROXY_SECRET`).
- **Media library** at `/edit/media`: browse, search, upload, see where an image is used, delete. Large photos are scaled to 2400px in the browser.
- **Date fields** with no time stay day-only (`time: false`, or any stored `2026-11-05`).
- **Posts**: `collections` in the sections module describes Markdown folders, edited at `/edit/collection/<id>`: frontmatter form, Markdown with toolbar and live preview, drafts. New `date` and `tags` field types. Untouched frontmatter keeps its exact formatting.
- **Synced patterns**: copies stay linked and "Update all copies" rewrites them in one commit. Pages stay plain JSON, so the build needs no lookup.
- **Block transforms** ("Turn into…", optional `transforms` on a schema) and `/` in an empty block to open the inserter, with the pick replacing that block.
- **Cloudflare Workers**: runs on workerd with `@astrojs/cloudflare`. Uploads now wait on a `pagestack-uploads` branch instead of in memory, so an upload and the save after it can reach different instances and a restart loses nothing. `pendingAsset` is now async.
- **Requires** Astro 7.2.1+ and Node 22.23.4+; `@astrojs/node` 11.1.11. This clears Astro's AVIF remote code execution advisory and the others against 6.x.
- **Storage**: `commit()` accepts `deletes`; adapters add `history()` and `readAt()`.
- Fixes: toolbar text could be saved into headings (the toolbar is now an overlay); sidebar fields lost focus while typing; a debounced edit could swallow an undo step; `moveNode` used a stale path when moving between lists; "Blank container" no longer assumes a `container` type; the 840px "desktop" preview was not desktop width.

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
