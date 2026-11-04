# Working on PageStack (guide for AI agents and contributors)

PageStack is an Astro integration that adds a visual section editor to a static site. The public
site stays fully static; the editor exists only on `/edit/*` and `/api/editor/*`, only when the host
turns it on; pages are JSON in the host's repo; saving is a file write (dev) or one git commit
(production); login is passkeys. Published on npm as **`@pirateandfox/pagestack`**. Repo:
https://github.com/pirateandfox/pagestack. First host site: `pirateandfox/lcfcc-web`.

Read this before changing anything. The non-negotiables are in section 6.

## 1. Layout

```
index.mjs              the Astro integration: options, virtual modules, injected routes, middleware, adapter handling
bin/invite.mjs         CLI `pagestack-invite`: mints a one-time passkey invite link (plain JS, no deps)
src/runtime.ts         the ONLY module hosts import at render time: types, nodeAttrs/fieldAttrs/child, newId, withDefaults
src/core/              pure logic, unit-tested, no DOM/Node: schema (validate, form groups), patch (undo/redo ops),
                       storage (interface) + storage-local (fs) + storage-github (REST, one commit per save), auth (HMAC
                       tokens, sessions), users (editor-users.json model)
src/server/            context.ts (resolved options, storage instance, page IO), middleware.ts (auth guard),
                       webauthn.ts (passkey ceremonies)
src/routes/            edit-index.astro (/edit), edit-page.astro (/edit/<slug>, the shell), preview.astro
                       (/edit/preview/<slug>, renders the host's page in edit mode), login.astro, enroll.astro,
                       api/{page,pages,images,asset,auth}.ts
src/client/            browser code for the shell: editor.ts (orchestration), state.ts (doc + history), tree.ts,
                       form.ts (schema -> sidebar form), inline.ts (click-to-edit text), picker.ts (images),
                       auth.ts, invite.ts, shell.css, preview.css (injected into the iframe)
test/                  vitest unit tests for src/core (+ form.ts via happy-dom)
ROADMAP.md             what is planned; CHANGELOG.md: what shipped, per version
```

There is **no build step**. The package ships source (`index.mjs`, `bin/`, `src/*.ts|.astro|.css`);
the host's Vite compiles it (`ssr.noExternal` is set for the package name in `index.mjs`). Keep it
that way unless there is a strong reason: it keeps releases trivial and lets hosts read the code.

## 2. How it plugs into a host

The host passes two files to the integration:

- `renderer`: an Astro component with props `{ page: PageDoc, editing?: boolean }` that renders a
  whole page inside the site's own layout. The preview route imports it through the virtual module
  `virtual:pagestack/renderer`, so the editor shows exactly what the static build will produce.
- `sections`: a module exporting `schemas` (a `SchemaRegistry`: field definitions per node type)
  and `presets` (`Preset[]`: labelled factories for "Add section"). Loaded via `virtual:pagestack/site`.

The host's components mark up what is editable with the runtime helpers:
`{...nodeAttrs(edit, node)}` on each node's root element, `{...fieldAttrs(edit, 'name', 'text'|'richtext'|'image')}`
on the element showing a field, `child(edit, i)` for children. These emit `data-ase-node`,
`data-ase-id`, `data-ase-field`, `data-ase-field-type` in edit mode and nothing in a static build.
The client (`editor.ts`, `inline.ts`, `preview.css`) and the host e2e tests depend on those attribute
names. (`ase` is the prefix inherited from the original name; renaming it is a roadmap decision, not
something to do piecemeal.)

Options (`index.mjs` JSDoc is the source of truth): `renderer`, `sections` (required); `pagesDir`,
`imagesDir`, `uploadsDir`, `publicDir`, `usersFile`, `auth` (`passkey` | `none-behind-proxy` | `none`,
dev only), `storage` (`local` | `github`), `github: { repo, branch?, pullRequest? }`, `enabled`,
`siteName`, `secretEnv`, `interactiveSelector`.

Environment at runtime (never in the repo): `EDITOR_SECRET` (16+ chars, signs sessions/challenges/
invites), `EDITOR_ORIGIN` (behind a proxy), `GITHUB_TOKEN` (github storage; contents + pull requests
on one repo). The host conventionally gates the integration on `EDITOR=dev` / `EDITOR=1`.

Build modes: with the integration disabled the host's build is untouched. Enabled in a build, the
public pages are still prerendered and only the editor routes are server-rendered; if the host has
no adapter we add `@astrojs/node` (standalone) and forward its hooks. If the host declares an
adapter (e.g. Cloudflare) we use it, which is how the editor can run on the same deployment as
the static site.

## 3. Develop

```bash
npm install
npm test                 # vitest, ~1s, must stay green
```

Most behaviour can only be seen inside a host. Use the LCFCC site (or any host) with a local link:

```bash
# in the host repo
npm install ../pagestack            # or: npm link ../pagestack   (symlink; Vite follows it)
npm run dev:editor                  # EDITOR=dev astro dev -> http://localhost:4321/edit
npm test                            # the host's Playwright suite exercises login, edit, save, rebuild
```

Do **not** commit the host's `package.json`/lockfile pointing at a local path. Before you finish,
put the host back on a published version (`npm install @pirateandfox/pagestack@<version> --save-exact`).

Checklist for any change:

1. `npm test` here.
2. In a host with the editor on: open `/edit/<slug>`, select a section in the tree and in the preview,
   edit text inline, pick an image, add/duplicate/reorder/delete a block, undo/redo, save, reload.
3. The host's static build (`npm run build`) still has no `dist/server` and no editor attributes in
   its HTML, and the host's `npm test` passes.
4. If you changed anything a host can observe (options, runtime exports, attribute names, routes,
   storage format, `editor-users.json` shape), it is a breaking change: note it in CHANGELOG and
   bump accordingly.
5. Nothing site-specific landed in this package (grep for host names, class names, URLs). Anything a
   host might need to vary is an option with a sensible default.

## 4. Release

Versions are git tags `vX.Y.Z[-beta.N]` on `main`, one CHANGELOG entry each, published to npm.
Pre-1.0 releases go out as `0.1.0-beta.N` under the `beta` dist-tag so `npm install @pirateandfox/pagestack`
never hands someone a beta by accident.

```bash
# 1. make sure main is clean and tests pass
git status && npm test

# 2. write the CHANGELOG entry under a new "## 0.1.0-beta.N — YYYY-MM-DD" heading, commit it

# 3. bump + tag (npm version commits package.json and creates the tag)
npm version prerelease --preid beta        # 0.1.0-beta.4 -> 0.1.0-beta.5
#   npm version minor / patch                for stable releases later

# 4. publish (public scoped package; npm asks for a one-time code if 2FA is on)
npm publish --access public --tag beta --otp <code>
#   stable later: npm publish --access public      (goes to `latest`)

# 5. push the commit and the tag
git push --follow-tags

# 6. verify, then bump the host(s)
npm view @pirateandfox/pagestack versions dist-tags
cd ../lcfcc-web && npm install @pirateandfox/pagestack@0.1.0-beta.5 --save-exact && npm run build && npm test
```

Notes:

- `npm whoami` must show an account with publish rights on the `@pirateandfox` scope. Login tokens
  expire; re-run `npm login` if publish returns 401 or a bare 404 on the scope.
- Right after a first publish the registry can return 404 anonymously for several minutes while
  authenticated requests succeed. Wait; do not re-publish.
- If a host's lockfile still records a `git+ssh` URL for the package after switching to a version,
  `npm uninstall` then `npm install <pkg>@<version> --save-exact` so it resolves to the registry tarball.
- The bare name `pagestack` is blocked by npm's similarity rule (unrelated `page-stack`), and the
  `pagestack` org was taken, hence the company scope. Moving to another name later means publishing
  under it and `npm deprecate`-ing this one with a pointer.
- Unpublishing is only possible within 72 hours and only if nothing depends on it. Prefer a new version.

## 5. Dependencies

- `astro` is a peer dependency (`>=5`). `@astrojs/node` is pinned **exactly** to `10.1.1`: 10.1.2+
  imports `createRequestFromNodeRequest`, which only Astro 6.4+ exports, and hosts are on 6.3.
  Re-check before raising either.
- `@simplewebauthn/browser` + `@simplewebauthn/server` for passkeys; `sortablejs` for drag-reorder.
- `happy-dom` and `vitest` are dev-only. Keep the dependency list this short; every runtime
  dependency ships into every host.

## 6. Non-negotiables

- **The public site stays static and clean.** No editor code, CSS or attributes on public pages. A
  disabled integration must leave the host's build byte-identical.
- **No hosted services, no database.** Content lives in the host's repo. The only server state is the
  signed cookie; the only secret is `EDITOR_SECRET`. Public keys in `editor-users.json` are not secrets.
- **Nothing site-specific.** No host names, class names, URLs or content in this package. Vary it by option.
- **Never commit to a host's `main` from the editor** unless the host configured that branch
  explicitly. The `github` storage commits to `github.branch` and can open a PR instead.
- **Security before convenience.** `auth: 'none'` is refused in builds. New routes go behind the
  middleware. Validate every page on save (`validateDoc`). Treat uploaded files and rich text as untrusted.
- **Keep the host contract stable.** `src/runtime.ts` exports, option names, route paths, the
  `data-ase-*` attributes, the page JSON shape and `editor-users.json` are public API. Changing them
  is a major (or, pre-1.0, a clearly flagged minor) with a migration note.

## 7. Roadmap pointers

See `ROADMAP.md`. The near-term items: add/delete page from `/edit`, hardening (rate limiting,
rich-text sanitising, upload limits, user removal), proving the Cloudflare adapter, a Publish
button over a staging branch, and the `ase` prefix decision before 1.0.
