# PageStack

A visual editor for Astro sites where pages are a stack of sections. Git-only: saving is a commit,
the public site stays static, and nothing lives outside the repo.

- The public site stays **fully static**. `astro build` is unchanged.
- The editor (`/edit/*`, `/api/editor/*`) is on-demand rendered and only exists when asked for:
  `EDITOR=dev astro dev`, or a build made with `EDITOR=1` (which adds `@astrojs/node` unless the site has an adapter).
- Pages are JSON documents in the repo (`src/content/pages/<slug>.json`). Saving writes a file
  (dev) or makes **one commit** through the GitHub API (production). Nothing is stored anywhere else.
- Login is **passkeys** (WebAuthn). Users' public keys live in a committed `editor-users.json`;
  the only server secret is `EDITOR_SECRET`. No database, no session store.
- Live preview renders the real page with the site's own components, in the browser's iframe.

Status: **early beta** (`0.1.0-beta.x`). The API will move; pin a version. See [ROADMAP.md](ROADMAP.md)
and [CHANGELOG.md](CHANGELOG.md).

## Versions

Published on npm as **`@pirateandfox/pagestack`** (betas under the `beta` dist-tag):

```bash
npm install @pirateandfox/pagestack@beta
```

Or install from a git tag and bump the tag to upgrade:

```json
"dependencies": { "@pirateandfox/pagestack": "github:pirateandfox/pagestack#v0.1.0-beta.4" }
```

```bash
npm install            # after changing the tag
```

Releases are tags `vX.Y.Z[-beta.N]` on `main`; each one has a CHANGELOG entry.

## Install

```js
// astro.config.mjs
import pagestack from '@pirateandfox/pagestack';

export default defineConfig({
  integrations: [
    pagestack({
      renderer: './src/components/SectionPage.astro', // renders { page, editing }
      sections: './src/sections/index.ts',            // exports { schemas, presets }
      siteName: 'Acme site editor',
      interactiveSelector: 'summary, .tabs__title, .map__load', // preview elements that keep their own click
      reservedSlugs: blogSlugs,                        // URLs the site uses some other way
      auth: 'passkey',                                 // 'passkey' | 'none-behind-proxy' | 'none' (dev only)
      storage: process.env.EDITOR === '1' ? 'github' : 'local',
      github: { repo: 'acme/site', branch: 'main', pullRequest: true },
    }),
  ],
});
```

```bash
EDITOR=dev astro dev        # editor at http://localhost:4321/edit, saves to the working tree
astro dev                   # the site alone: no editor, nothing can write content
EDITOR=1 astro build        # dist/server (node) + dist/client — the editor for a host
astro build                 # plain static site, no editor code
```

## What the site provides

### 1. A content model: `src/content/pages/<slug>.json`

```jsonc
{
  "title": "Home",
  "description": "…",
  "layout": { "footer": "big", "css": ["post-9.css"] },   // opaque to the editor
  "sections": [
    { "id": "c8da6f4", "type": "container", "settings": { "backgroundColor": "#fff" },
      "blocks": [
        { "id": "1a2b3c4", "type": "heading", "settings": { "text": "Hello", "tag": "h1" } },
        { "id": "5d6e7f8", "type": "text",    "settings": { "html": "<p>…</p>" } }
      ] }
  ]
}
```

A page is a tree of nodes. Top-level nodes are *sections*; anything can nest (`blocks`).
`attrs` is a passthrough for element attributes the editor never shows (class, aria-*).
`"status": "draft"` keeps a page out of the build; without it the page is published.

To let editors add pages, render them from one catch-all route. A new JSON file is then a new page,
and drafts are left out:

```astro
---
// src/pages/[...page].astro
import { staticPages } from '@pirateandfox/pagestack/runtime';
import SectionPage from '../components/SectionPage.astro';
export const getStaticPaths = () =>
  staticPages(import.meta.glob('../content/pages/**/*.json', { eager: true }));
const { page } = Astro.props;
---
<SectionPage page={page} />
```

A site with its own `.astro` file per page keeps working, but pages added in the editor have no
route until the catch-all exists.

### 2. A block registry: `src/sections/index.ts`

```ts
import type { BlockSchema, Preset } from '@pirateandfox/pagestack/runtime';
export const schemas = {
  heading: {
    label: 'Heading',
    fields: {
      text:  { type: 'text',   label: 'Text', inline: true, default: 'Heading' },
      tag:   { type: 'select', label: 'HTML tag', options: [...], default: 'h2', group: 'advanced' },
      color: { type: 'color',  label: 'Text colour', group: 'style' },
    },
    component: Heading,            // the Astro component
  },
  container: { label: 'Container', fields: {...}, blocks: '*', component: Container },
  gallery:   { label: 'Gallery', fields: {}, blocks: ['gallery-item'], component: Gallery },
  'gallery-item': { label: 'Image', fields: {...}, hidden: true, component: GalleryItem },
} satisfies Record<string, BlockSchema & { component: any }>;

export const presets: Preset[] = [
  { label: 'Hero', description: 'Full-width image with a heading and two buttons', create: () => ({ ... }) },
];
```

Field types: `text`, `richtext`, `image`, `link`, `color`, `select`, `number`, `boolean`,
`textarea`, `code`, `svg`. `inline: true` on `text` / `richtext` / `image` makes the field
editable by clicking it in the preview. The schema drives the sidebar form, validation on save,
the add-block menus and the tree labels. **Presets are the section library.**

### 3. Components that mark what they render

Each block component receives `{ node, edit }` and spreads two helpers onto its markup:

```astro
---
import { nodeAttrs, fieldAttrs } from '@pirateandfox/pagestack/runtime';
const { node, edit } = Astro.props;
---
<div {...nodeAttrs(edit, node)}>
  <h2 {...fieldAttrs(edit, 'text', 'text')} set:html={node.settings.text} />
</div>
```

`edit` is `undefined` on the public site, so nothing leaks into the static output. A container
passes `child(edit, i)` to each child. The `renderer` component takes `{ page, editing }` and
renders the page inside the site's normal layout.

## Editing

Coming from the WordPress block editor:

| WordPress | PageStack |
|---|---|
| Pages list | `/edit`: search, status, add, copy, delete |
| Block inserter, Patterns | `+` or `/`: searchable blocks by category, Patterns tab, `+` between sections |
| List View | Same, with drag to reorder and to move between containers |
| Block toolbar, ⋮ menu | Move, parent, add, duplicate, delete, copy, save as pattern |
| Settings sidebar, Page / Block tabs | Same, generated from the schema |
| Rich text toolbar, links | Same; `⌘B`, `⌘I`, `⌘K`, and an HTML view |
| Save draft, Publish, Preview | Same; Preview opens the unsaved draft in a new tab |
| Revisions | The page's git history |
| Permalink | Change URL, which also adds a redirect |
| Menus, site options | Global content, at `/edit/global/<id>` |
| Patterns, synced patterns | Saved patterns; synced ones update every copy in one commit |
| Block transforms | ⋮ → Turn into… |
| `/` in an empty block | Same |
| Posts | `/edit/collection/<id>`: details form, Markdown with live preview |
| Media Library | `/edit/media` |
| Users, roles | `/edit/users`: Admin and Editor |

- **Preview**: the page renders in a frame at real device widths, scaled to fit. Every change POSTs
  the draft to `/edit/preview/<slug>`; the server renders it and only changed sections are swapped.
- **Inline**: click text to edit it in place; click an image to open the picker (alt text required).
- **Drafts** are kept in `localStorage` until saved; undo/redo is per session.
- **Save** sanitises rich text, validates the document, and writes the file (local) or commits
  (github). A hash of what you loaded is sent along; if someone saved first you get a 409 and a
  reload prompt.

Optional exports from the `sections` module:

```ts
// Fields on the Page tab, stored in page.layout
export const pageFields = {
  footer: { type: 'select', label: 'Footer', options: [{ value: 'big', label: 'Big' }, { value: 'small', label: 'Small' }] },
};

// Starting points offered by Add page
export const templates = [{ label: 'Standard page', create: ({ title }) => ({ title, sections: [/* … */] }) }];

// JSON files edited at /edit/global/<id>
// Markdown folders edited at /edit/collection/<id>
export const collections = {
  blog: {
    label: 'Posts', singular: 'post', dir: 'src/content/blog', url: (slug) => `/${slug}/`,
    fields: { title: { type: 'text', label: 'Title' }, draft: { type: 'boolean', label: 'Draft' }, date: { type: 'date', label: 'Date' }, tags: { type: 'tags', label: 'Tags' } },
  },
};

export const globals = {
  menus: {
    label: 'Menus',
    file: 'src/data/menus.json',
    fields: {
      nav: { type: 'list', label: 'Main menu', itemLabel: 'label', fields: { label: { type: 'text', label: 'Label' } } },
    },
  },
};
```

#### Editing a collection item on its own page

Give a collection a layout in `previews` (an option on the integration) and its items open on that
page in the editor: click the title, a paragraph, a heading, a list or a quote and type; click an
image to pick another; tables, code and nested lists open the Markdown with that block selected. The
**+** beside a block, or `/` in an empty one, adds a paragraph, heading, list, quote, image or table
there. **Page** and **Markdown** switch views, and Preview ↗ shows the unsaved item in a tab. An
edited block is turned back into Markdown and replaces only its own lines, so the rest of the file
stays byte-for-byte as it was.

The ⋮ menu has **Change URL** (moves the file; with the collection's `url` and a redirects file, the
old address redirects in the same commit), **Revisions** (the file's git history; Restore loads one
as unsaved changes, covering the body and the fields the editor shows) and **Delete**.

```js
pagestack({ /* … */ previews: { blog: './src/editor/PostPreview.astro' } })
```

The layout gets `{ item: { id, collection, data, body, html, headings }, editing }`. `html` is the
sanitised body (render it with `set:html`), blocks already marked; `data` is the frontmatter as
written, so apply the defaults and date parsing your content schema would. Mark the item's own
fields with `itemField(editing, 'title')` from the runtime, or write the same two attributes
(`data-ps-field`, `data-ps-field-type`) yourself. Sharing one component between the real page
and the preview keeps them identical:

```astro
---
// src/editor/PostPreview.astro
import PostPage from '../components/PostPage.astro';
const { item, editing } = Astro.props;
---
<PostPage data={{ ...item.data, date: new Date(item.data.date) }} headings={item.headings} editing={editing}>
  <Fragment set:html={item.html} />
</PostPage>
```

The preview renders on the editor's server (a Worker on Cloudflare), so whatever the layout imports
must run there: no `node:fs` reads of the project, no native modules (sharp, resvg), and no import of
`content.config.ts` (its loaders only run in a build). `getCollection` works. The page's own scripts
are left out of the editor's frame.

In the block editor's preview the site's own scripts do run (tabs, accordions), but scripts from
other origins are refused, so analytics, captchas and chat widgets stay out of the editor.
`previewScripts: 'all'` lifts that for a site whose preview needs an outside script.

An image field stored as a bare URL can name its alt-text field, `{ type: 'image', asUrl: true,
altField: 'imageAlt' }`, and the picker fills it in.

Blocks can set `category` and `keywords` for the inserter. A `list` field is a repeatable group of
`fields`, with `itemLabel` naming the field that titles each row.

## Security

Everything an editor sends is treated as untrusted. On save, every field is cleaned by its type,
and anything outside the schema is cleaned as HTML, so components can render fields with
`set:html`. Only admins can put raw HTML in a `code` field. Uploads are checked by their bytes and
SVGs are sanitised. Set `EDITOR_ORIGIN` to the public https origin in production.

With `auth: "none-behind-proxy"`, set `EDITOR_PROXY_SECRET` if the app can be reached without going
through the proxy: requests must then carry the same value in `x-editor-proxy-secret`. Otherwise the
identity headers could be forged by anyone who reaches the app directly.

The login rate limit is held in memory per server instance, so on Workers it slows guessing rather
than setting a hard limit. Passkeys are what actually stops guessing.

## Storage

| `storage` | Reads | Saves | Uploads |
|---|---|---|---|
| `local` (dev default) | working tree | writes the JSON file (you commit) | written to `public/images/uploads/` |
| `github` (build default) | Contents API on `github.branch` | one commit via the Git Data API: blobs → tree → commit → ref; with `pullRequest: true` a new `site-editor/<timestamp>-<sha>` branch + PR instead | wait on a `pagestack-uploads` branch until the next save brings them along; the editor serves them, and anything committed since it was built, to signed-in editors |

### Staging and Go live

With `github.live`, saves stay on `github.branch` (staging) and the public site builds from `live`.
Every screen gets a **Go live** button counting the saved changes the live site doesn't have yet;
it lists them, links to `github.stagingUrl` if you give one, and puts them all on `live` in one step.
That is a fast-forward when nobody committed to `live` directly. When someone did, it makes a merge
commit and moves staging to it; when their change conflicts, it refuses and says so, and a person
merges in GitHub. A burst of saves becomes one production build.

```js
github: { repo: 'acme/site', branch: 'develop', live: 'main', stagingUrl: 'https://develop.acme.pages.dev/' }
```

Point the host's production deploy at `live` and its preview deploys at the staging branch.

The GitHub token (`GITHUB_TOKEN` or `EDITOR_GITHUB_TOKEN`) is read from the environment on the
server only. A fine-grained token with *Contents: write* (and *Pull requests: write* for PR mode)
on the one repo is enough. The host that runs the editor rebuilds and deploys from the commit
like any other push.

## Login

### `auth: "passkey"` (default)

- `editor-users.json` (committed, path configurable with `usersFile`) holds users and the
  **public keys** of their passkeys. Nothing in it is secret.
- `EDITOR_SECRET` (≥ 16 chars, environment only) signs three kinds of short-lived tokens:
  WebAuthn challenges (5 min), the session cookie (`ps_session`, HttpOnly, SameSite=Lax, 12 h) and
  invite links (3 days). Tokens are `base64url(json).base64url(hmac-sha256)` with the expiry inside,
  so there is no server state.
- **Invites** are single-use: the invite id is recorded on the credential it created. Make the first
  one from the CLI, later ones from the "Invite another editor" panel on `/edit`:

  ```bash
  EDITOR_SECRET=… npx pagestack-invite --name "Jane Doe" --email jane@example.com --origin https://example.com
  ```
- `/edit/enroll?invite=…` creates the passkey (Touch ID / Face ID / Windows Hello / security key);
  `/edit/login` signs in with it. Several passkeys per person are fine (enrol again with a new invite).
- Set `EDITOR_ORIGIN` when a proxy rewrites `Host`; WebAuthn binds credentials to the origin the
  browser sees.
- The signature counter is not persisted (it would mean a commit per login; synced passkeys report 0).

### `auth: "none-behind-proxy"`

Use when something in front of the editor already authenticates people, e.g. **Cloudflare Access**:
put the editor host behind an Access application for `/edit/*` and `/api/editor/*`, allow the
client's email addresses, and the editor trusts the proxy. It reads the identity from
`Cf-Access-Authenticated-User-Email` (or `X-Forwarded-User`) for commit attribution. This is a
good fit when the site already sits on Cloudflare and the client prefers email one-time codes over
passkeys. (A production deployment should also verify the Access JWT on the editor host; that's not
implemented here.)

### `auth: "none"`

Dev only. A build with `auth: "none"` is refused.

## Deploying the editor

Requires Node 22.23.4+ and Astro 7.2.1+. On Cloudflare, add `@astrojs/cloudflare` as the host's
adapter and set `EDITOR_SECRET`, `EDITOR_ORIGIN` and `GITHUB_TOKEN` as secrets.

The editor server is a normal `@astrojs/node` standalone build. Run `node dist/server/entry.mjs`
on any small Node host (Fly, Railway, a VPS…) with `EDITOR_SECRET`, `GITHUB_TOKEN` and
`EDITOR_ORIGIN` set, behind HTTPS. It serves the editor routes and the static pages it was built
with; the public site is still deployed separately from the same repo as static files. Every
editor response is `noindex` and `no-store`.

## Options

| option | default | |
|---|---|---|
| `renderer` | required, unless `pages: false` | Astro component rendering `{ page, editing }` |
| `pages` | `true` | `false` for a site with no block pages: only collections, globals and media |
| `previews` | `{}` | per collection id, an Astro layout for editing items on their page (see above) |
| `sections` | required | module exporting `{ schemas, presets }` |
| `pagesDir` | `src/content/pages` | |
| `imagesDir` / `uploadsDir` / `publicDir` | `public/images` / `public/images/uploads` / `public` | |
| `usersFile` | `editor-users.json` | |
| `auth` | `passkey` | `passkey` \| `none-behind-proxy` \| `none` |
| `storage` | `local` in dev, `github` in build | |
| `github` | — | `{ repo, branch, live?, stagingUrl?, pullRequest? }`: see Staging and Go live |
| `previewScripts` | `'site'` | block-editor preview runs the site's own scripts only; `'all'` allows other origins too |
| `enabled` | `EDITOR=dev` (dev) or `EDITOR=1` | Off otherwise, so plain `astro dev` never writes content |
| `siteName`, `secretEnv` | `Site editor`, `EDITOR_SECRET` | |
| `reservedSlugs` | `[]` | URLs Add page must refuse, on top of the editor's own and `src/pages` |
| `redirectsFile` | `public/_redirects` | Change URL appends here, only if the file exists |
| `patternsFile` | `src/content/pagestack-patterns.json` | where saved patterns live |
| `clientIpHeader` | none | header with the client IP behind a proxy, for login rate limits, e.g. `cf-connecting-ip` |

## Open-source pieces used

- [SortableJS](https://github.com/SortableJS/Sortable) (MIT) for the tree drag-and-drop.
- [@simplewebauthn/server + browser](https://simplewebauthn.dev) (MIT) for WebAuthn.
- [@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/) (MIT) as the editor's adapter.
- [Puck](https://puckeditor.com) was used as a design reference for JSON page editing only; no code.

MIT.
