# astro-section-editor

A git-only, Shopify-style visual section editor that ships inside an Astro site.

- The public site stays **fully static**. `astro build` is unchanged.
- The editor (`/edit/*`, `/api/editor/*`) is on-demand rendered and only exists in `astro dev`
  or in a build made with `EDITOR=1` (which adds `@astrojs/node`).
- Pages are JSON documents in the repo (`src/content/pages/<slug>.json`). Saving writes a file
  (dev) or makes **one commit** through the GitHub API (production). Nothing is stored anywhere else.
- Login is **passkeys** (WebAuthn). Users' public keys live in a committed `editor-users.json`;
  the only server secret is `EDITOR_SECRET`. No database, no session store.
- Live preview renders the real page with the site's own components, in the browser's iframe.

Status: spike quality. See `docs/spikes/visual-editor-report.md` in the host repo for what is
and isn't done.

## Install

```js
// astro.config.mjs
import sectionEditor from 'astro-section-editor';

export default defineConfig({
  integrations: [
    sectionEditor({
      renderer: './src/components/SectionPage.astro', // renders { page, editing }
      sections: './src/sections/index.ts',            // exports { schemas, presets }
      siteName: 'Acme site editor',
      auth: 'passkey',                                 // 'passkey' | 'none-behind-proxy' | 'none' (dev only)
      storage: process.env.EDITOR === '1' ? 'github' : 'local',
      github: { repo: 'acme/site', branch: 'main', pullRequest: true },
    }),
  ],
});
```

```bash
npm run dev                 # editor at http://localhost:4321/edit, saves to the working tree
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

### 2. A block registry: `src/sections/index.ts`

```ts
import type { BlockSchema, Preset } from 'astro-section-editor/runtime';
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
import { nodeAttrs, fieldAttrs } from 'astro-section-editor/runtime';
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

- **Sidebar form** generated from the schema; live-debounced for colours and text.
- **Inline**: click text to edit it in place (plain text, or bold / italic / link for rich text);
  click an image to open the picker (library browse, search, upload; alt text is required).
- **Structure**: tree on the left (drag to reorder sections and nested blocks), in-page toolbar
  (move, duplicate, delete, select parent), "+ Add section" from presets, "+ Add block" from the
  schema's allowed children.
- **Preview**: every change POSTs the draft document to `/edit/preview/<slug>`; the server renders
  the full page in edit mode and the editor swaps only the sections that changed. Typically well
  under 20 ms server-side in dev.
- **Drafts** are kept in `localStorage` until saved; undo/redo is per session.
- **Save** validates the document and either writes the file (local) or commits (github). A hash of
  the content you loaded is sent along; if someone saved first you get a 409 and a reload prompt.

## Storage

| `storage` | Reads | Saves | Uploads |
|---|---|---|---|
| `local` (dev default) | working tree | writes the JSON file (you commit) | written to `public/images/uploads/` |
| `github` (build default) | Contents API on `github.branch` | one commit via the Git Data API: blobs → tree → commit → ref; with `pullRequest: true` a new `site-editor/<timestamp>-<sha>` branch + PR instead | staged in memory, served by the editor server until the next save commits them |

The GitHub token (`GITHUB_TOKEN` or `EDITOR_GITHUB_TOKEN`) is read from the environment on the
server only. A fine-grained token with *Contents: write* (and *Pull requests: write* for PR mode)
on the one repo is enough. The host that runs the editor rebuilds and deploys from the commit
like any other push.

## Login

### `auth: "passkey"` (default)

- `editor-users.json` (committed, path configurable with `usersFile`) holds users and the
  **public keys** of their passkeys. Nothing in it is secret.
- `EDITOR_SECRET` (≥ 16 chars, environment only) signs three kinds of short-lived tokens:
  WebAuthn challenges (5 min), the session cookie (`ase_session`, HttpOnly, SameSite=Lax, 12 h) and
  invite links (3 days). Tokens are `base64url(json).base64url(hmac-sha256)` with the expiry inside,
  so there is no server state.
- **Invites** are single-use: the invite id is recorded on the credential it created. Make the first
  one from the CLI, later ones from the "Invite another editor" panel on `/edit`:

  ```bash
  EDITOR_SECRET=… npx astro-section-editor-invite --name "Jane Doe" --email jane@example.com --origin https://example.com
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

The editor server is a normal `@astrojs/node` standalone build. Run `node dist/server/entry.mjs`
on any small Node host (Fly, Railway, a VPS…) with `EDITOR_SECRET`, `GITHUB_TOKEN` and
`EDITOR_ORIGIN` set, behind HTTPS. It serves the editor routes and the static pages it was built
with; the public site is still deployed separately from the same repo as static files. Every
editor response is `noindex` and `no-store`.

## Options

| option | default | |
|---|---|---|
| `renderer` | required | Astro component rendering `{ page, editing }` |
| `sections` | required | module exporting `{ schemas, presets }` |
| `pagesDir` | `src/content/pages` | |
| `imagesDir` / `uploadsDir` / `publicDir` | `public/images` / `public/images/uploads` / `public` | |
| `usersFile` | `editor-users.json` | |
| `auth` | `passkey` | `passkey` \| `none-behind-proxy` \| `none` |
| `storage` | `local` in dev, `github` in build | |
| `github` | — | `{ repo, branch, pullRequest }` |
| `enabled` | dev, or `EDITOR=1` | |
| `siteName`, `secretEnv` | `Site editor`, `EDITOR_SECRET` | |

## Open-source pieces used

- [SortableJS](https://github.com/SortableJS/Sortable) (MIT) for the tree drag-and-drop.
- [@simplewebauthn/server + browser](https://simplewebauthn.dev) (MIT) for WebAuthn.
- [@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/) (MIT) as the editor's adapter.
- [Puck](https://puckeditor.com) was used as a design reference for JSON page editing only; no code.

MIT.
