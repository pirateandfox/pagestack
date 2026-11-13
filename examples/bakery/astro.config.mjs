import { defineConfig } from "astro/config";

// The editor (PageStack) loads only when asked for: `EDITOR=dev astro dev` (npm run dev:editor).
// Plain `astro dev` / `astro build` never import it, so the public site is fully static.
// Explicit values only: $EDITOR is also the shell's default text editor.
const editor = process.env.EDITOR === "dev" || process.env.EDITOR === "1";
const { default: pagestack } = editor ? await import("@pirateandfox/pagestack") : {};

export default defineConfig({
  site: "https://crumb-and-co.example",
  output: "static",
  // Keeps the editor preview and the demo recordings free of the dev toolbar.
  devToolbar: { enabled: false },
  trailingSlash: "ignore",
  integrations: editor
    ? [
        pagestack({
          renderer: "./src/components/SectionPage.astro",
          sections: "./src/sections/index.ts",
          // News posts open on their own page in the editor and are edited in place.
          previews: { news: "./src/editor/NewsPreview.astro" },
          siteName: "Crumb & Co.",
          // A local demo: no login, saves write straight to the working tree.
          auth: "none",
          storage: "local",
        }),
      ]
    : [],
});
