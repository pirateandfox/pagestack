# Contributing

Thanks for looking. PageStack is young and opinionated; small, focused changes land fastest.

1. **Open an issue first** for anything bigger than a fix, so we can agree on the shape before you
   write it.
2. **Read [`AGENTS.md`](AGENTS.md).** It covers the layout, how the integration plugs into a host,
   how to develop against one, and the non-negotiables (static public site, content in the repo,
   no editor code on public pages).
3. **Develop against a real host.** `examples/bakery` is one:
   ```bash
   npm install
   cd examples/bakery && npm install && npm run dev:editor   # http://localhost:4321/edit
   ```
   The bakery installs PageStack from `../..` as a copy (`install-links` in its `.npmrc`), so run
   `npm install` there again after changing PageStack's source.
4. **Test.** `npm test` runs the unit tests. Add one for what you changed.
5. **Note it in `CHANGELOG.md`** under *Unreleased*, in plain words a site owner would follow.

By contributing you agree your work is released under the [MIT license](LICENSE).
