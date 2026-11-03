# Roadmap

What we plan for the editor, roughly in order. Items move to the CHANGELOG when they ship.
Host sites pin a version (git tag today, npm later) and bump when they want a new one.

## Now (0.1 betas)

- [x] Extract from the first host site; nothing site-specific left (`interactiveSelector` option).
- [x] Name: **PageStack** (`pagestack` on npm, GitHub `pirateandfox/pagestack`).
- [ ] Decide on the internal DOM prefix (`data-ase-*`, `.ase-*`, `__ASE__`, from the old name): keep as a short neutral prefix, or rename to `ps` before 1.0 while nobody depends on it.
- [ ] **Add / delete page** from `/edit`: title, slug, footer variant, start blank or from a copy of an existing page. Create endpoint validates the slug, refuses duplicates and reserved paths. The host site renders pages from one dynamic route over `src/content/pages/*.json`, so a new JSON file is a new page.
- [ ] **Hardening before the editor sits on a public domain:** rate limiting on `/api/editor/auth/*`, HTML sanitising of rich-text fields on save, upload resizing + size cap, remove a user / revoke a passkey.
- [ ] **Cloudflare adapter**: prove the editor routes run on Workers (the integration already forwards a host-supplied adapter; nothing outside local storage uses Node APIs). Document the one-Worker-with-static-assets deployment: public pages static, `/edit/*` on demand.
- [ ] **Dev default off**: hosts enable the editor explicitly (`EDITOR=dev astro dev`) so plain `npm run dev` never writes content.

## Next

- [ ] **Publish button / staging branch**: saves commit to a staging branch, a branch preview shows them, Publish fast-forwards `main`. Also collapses many saves into one production build.
- [ ] **Build coalescing** guidance: GitHub Action with `concurrency: cancel-in-progress` so a burst of saves is one deploy.
- [ ] **Rename page** = create + delete + a line in the host's redirects file.
- [ ] **Page templates**: "start from a copy of…" and host-defined starter pages.
- [ ] **Global content** (header nav, footer, site data) as an editable document with its own schema.
- [ ] **Blog posts**: Markdown collection editing (frontmatter form + body).
- [ ] npm publish (`pagestack`, name is free) once the API stops moving.

## Later / ideas

- Per-field history and "who changed what" from git log.
- Scheduled publish (commit now, merge at a time) via a GitHub Action.
- Image focal point + crop presets.
- Multi-site: one editor deployment, several repos.
- i18n: sibling page documents per locale.

## Non-goals

- A database, a hosted service, or anything holding content outside the repo.
- Rendering with anything other than the host site's own Astro components.
- Loading editor code on public pages.
