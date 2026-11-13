# Crumb & Co. — a PageStack demo site

A small Astro site for a made-up neighbourhood bakery, wired up with PageStack. Crumb & Co., its
people and its address are invented. Use it to try the editor, or as a starting point for a host.

```bash
npm install
npm run dev:editor        # EDITOR=dev astro dev
```

Open http://localhost:4321/edit. There is no login (`auth: "none"`, dev only) and saving writes the
JSON or Markdown file in this folder, so `git diff` shows what you changed.

| Script | |
|---|---|
| `npm run dev` | the public site alone; PageStack isn't even imported |
| `npm run dev:editor` | the site plus the editor at `/edit` |
| `npm run build` | the static site in `dist/`, no editor code |

`@pirateandfox/pagestack` comes from this checkout (`file:../..`). `.npmrc` sets `install-links`
so npm copies it in with its dependencies, the way a published version installs; run
`npm install` again after changing PageStack's source.

## What's where

- `astro.config.mjs`: imports and adds the integration only when `EDITOR` is `dev` or `1`.
- `src/sections/schema.ts`: fields for each section type (hero, product grid, image and text,
  text, kind words, hours and location, menu list, call to action) and their child blocks.
- `src/sections/index.ts`: the `sections` module: schemas, the "Add section" presets, the Page tab
  field, Add page templates, the Site details global (`src/data/site.json`) and the News collection.
- `src/sections/*.astro`: one component per type, marked up with `nodeAttrs` / `fieldAttrs`.
- `src/components/SectionPage.astro`: the `renderer`. `src/pages/[...page].astro` renders every
  `src/content/pages/*.json` with `staticPages()`.
- `src/content/news/*.md`, `src/editor/NewsPreview.astro`: news posts, edited in place on their
  own page through `previews`.
- `public/images/*.svg`: the illustrations, which also fill the editor's media library.
