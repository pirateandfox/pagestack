# Changelog

## 0.1.0-beta.13 — 2026-11-13

- **Only admins can publish.** With `github.live`, **Publish changes** puts staging live for admins only. Editors still see the count and the list of what's waiting, with a note that an admin publishes it; the API refuses them (403).
- **Withdraw an invite.** The Users screen lists invite links nobody has used yet (who, role, time left, who sent it), each with **Withdraw**: the link stops working at once. Invites made there are recorded in the users file (`invites`); used, withdrawn and expired ones drop off. Links from the `pagestack-invite` CLI aren't listed.
- **Signing out is a POST.** The Sign out links are now small forms, and the editor menu posts. A GET to `/api/editor/auth/logout` only shows a Sign out button, so a link on another site can't sign anyone out.
- **No lost changes to the users file.** Enrolling, inviting, changing a role and removing someone now read, change and save the file as one step: if another change landed in between, the file is read again and the change re-applied. Storage adapters gained a conditional commit (`expect`, throwing `StaleWrite`).
- Astro's dev toolbar no longer shows inside the editor's preview.
- Hosts: the message for a used invite link is now "This invite link has already been used or was withdrawn."

## 0.1.0-beta.12 — 2026-11-13

- **Site pages on a deployed editor need sign-in, and open in Browse.** The editor's build carries a copy of every site page, and Cloudflare served those files before the editor's code ran: anyone could read them (saved work included, for pages rebuilt from a staging branch), and opening one showed no editor bar. On Cloudflare, editor builds now route everything except hashed build assets through the editor's Worker (`assets.run_worker_first` is set in the generated `dist/server/wrangler.json`, unless the host set it) and PageStack wraps the adapter's entry: a page opened directly goes to Browse, a page loaded any other way needs a session. Styles, scripts, images and fonts are served as before. Hosts change nothing.
- **A deployed editor missing `GITHUB_TOKEN` or `EDITOR_SECRET` says so** on every editor page, instead of a 500.
- The editor's copies of site pages are sent with `X-Robots-Tag: noindex`.
- **Saving in dev no longer reloads the editor.** A save writes files the site's routes import, and Vite answered with a full reload of every open page, which threw away the selection and undo history. Reloads caused by the editor's own writes are now dropped.
- Editor pages have a favicon (the PageStack mark).
- **`examples/bakery`**: Crumb & Co., an invented bakery site to try the editor on (`npm run dev:editor`).
- `@astrojs/cloudflare` is now an optional peer dependency.
- Repo: MIT `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, issue templates; tests run only from `test/`.

## 0.1.0-beta.11 — 2026-11-13

**Security fixes. Upgrade before inviting people.**

- **Rich text could carry a script past the sanitiser.** Its tag reader disagreed with browsers about where an unquoted attribute value ends, so a crafted `<img … onerror=…>` saved by any editor came through unchanged and ran in an admin's editor (and on the public site after a publish). Tags are now read the way the HTML spec's tokenizer reads them, and anything not plainly written is rebuilt from what was read. A new test runs the sanitiser's output through a spec HTML parser (`parse5`, dev only) with known bypasses and 20,000 generated tags. Inline SVG fields had the same problem and get the same fix.
- **No inline event handlers anywhere on the editor's origin**: `script-src-attr 'none'` on every editor response, preview and live page, and (new) on the site's built pages the editor serves, through a block appended to the editor build's static `_headers` file. Those pages also get the site-scripts-only rule.
- **Invite links can't be used twice**, even after the person or the passkey made from them is removed: used invite ids are kept in the users file (`usedInvites`).
- **Removing a passkey ends the sessions it opened.** Sessions now name their passkey and stop working when it is gone (sessions from before this release last until they expire).
- **Removed `/api/editor/asset/*`**, a debugging route that let any signed-in editor read any file in the repo, `editor-users.json` included.
- Sign-in reads the users file through the cache, and a lookup that misses re-reads at most every 5 s, so unauthenticated requests can't spend the GitHub token's quota.
- The uploads route checks that the person still exists, not just the cookie's signature.
- Commit subjects sent by the client are cut to one line and can't claim "Edited by" someone else.
- Sign-in errors no longer echo internal error text. The proxy shared secret is compared in constant time.

- **Ready to publish switch** replaces the Publish / Switch to draft / Save draft / Update buttons on pages and collection items. Flipping it saves straight away and says what it means; Save is always "Save". Without `github.live` the switch reads **Published**. A page only asks before turning into a draft when that takes it off the site at the next build.
- **Go live is now labelled "Publish changes"**, so "publish" always means the public site. Element ids are unchanged (`#ps-live`); `#ps-publish`, `#ps-item-publish` and `#ps-item-draft` are gone (use `#ps-ready` / `#ps-item-ready`, or click `#ps-ready-wrap` / `#ps-item-ready-wrap`).

## 0.1.0-beta.10 — 2026-11-12

- **Faster first load of live pages and previews.** Live collections now load together, pinned to the branch head, in one GitHub GraphQL request instead of a listing plus one request per file (Sentiosonics: 70 requests and about 10 s on a fresh server, now 11 requests and under 5 s locally). Falls back to the REST reads when GraphQL isn't available. New optional storage method `readDirs(paths, ref)`.
- **Browse shows when a page is loading**: a moving strip under the bar and "Loading page…", instead of a blank frame.

## 0.1.0-beta.9 — 2026-11-12

- **Browse site** (`/edit/site`): the site as visitors see it, with a bar on top. Click around; **Edit this page** opens the editor for what's showing, and the editor's **View on site** comes back. Pages and items with a `previews` layout show their latest saved version; other pages show the editor's built copy, and the bar warns when something has been saved since that build. Back and Forward work. The View buttons across the editor now open Browse, and the nav's "View site ↗" is now "Browse site".
- **Live list pages** (`liveRoutes`): in the editor's build only, the named pages render on request, reading collections from storage through the new `@pirateandfox/pagestack/live` export (`liveEntries`). A new or edited item shows in them straight away. The public build is unchanged. Opened directly on a deployed editor, they land in Browse.
- Storage adapters gain optional `readDir`, `head` and `lastChange`. On GitHub, `readDir` caches file contents by blob hash.
- `site` is now a reserved page slug (`/edit/site` is Browse).

## 0.1.0-beta.8 — 2026-11-11

**Breaking, for host sites:** everything the editor puts on a page now uses the `ps` prefix instead of `ase`, from the editor's old name: `data-ps-node`, `data-ps-field`, `data-ps-field-type`, `data-ps-id`, `.ps-*` classes, `window.__PS_*__`. Hosts that only use `nodeAttrs` / `fieldAttrs` / `itemField` need nothing. Hosts that write the attributes by hand, or tests that select `.ase-*`, replace `ase` with `ps` (`data-ase-` → `data-ps-`, `.ase-` → `.ps-`). Editors are signed out once (the session cookie is now `ps_session`).

**Also changed:** the editor is off unless asked for. `astro dev` alone no longer includes it; use `EDITOR=dev astro dev` (or `EDITOR=1`). A host passing `enabled` is unaffected.

- **Go live**: with `github.live`, saves wait on the staging branch and a Go live button on every screen puts them on the live branch in one step, with the list of changes and a link to the staging site (`github.stagingUrl`). Fast-forward when possible, a merge commit when someone committed to live directly, and a clear refusal on a conflict. Saving then says "Use Go live to put it on the site."
- **Collection items**: Change URL (with a redirect), Revisions with Restore, and Delete, from a ⋮ menu.
- **Adding blocks on the page**: a + beside each block, and `/` in an empty one, add a paragraph, heading, list, quote, image or table. A block added and left untouched goes away again.
- **Lists and quotes are edited in place**, like paragraphs: flat bulleted and numbered lists, and one-paragraph quotes. Nested lists, task lists and tables still open the Markdown.
- **Third-party scripts stay out of the block editor's preview**: the site's own scripts run, scripts from other origins are refused (`previewScripts: 'all'` to allow them). The item frame no longer loads the site's scripts at all, which also ends a console error per script.

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

First tagged release, extracted with its history from the site it was first built for.

- Integration: `/edit`, `/edit/login`, `/edit/enroll`, `/edit/preview/*`, `/api/editor/*` routes; static build untouched unless `EDITOR=1`.
- Editor: section tree, schema-driven inspector, inline text editing, image picker + uploads, presets ("Add section"), reorder / duplicate / delete, undo/redo, drafts, page settings.
- Storage: local working tree (dev) or one GitHub commit per save (optional PR), hash check against concurrent saves.
- Auth: passkeys with one-time invite links, stateless HMAC challenges, signed cookie sessions.
- New: `interactiveSelector` option replaces a hard-coded list of host-site class names.
