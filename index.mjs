// pagestack — a git-only visual section editor that ships inside an Astro site.
//
//   import pagestack from '@pirateandfox/pagestack';
//   integrations: [sectionEditor({ renderer: './src/components/SectionPage.astro', sections: './src/sections/index.ts' })]
//
// The public site stays fully static. The editor (/edit/*, /api/editor/*) is on-demand rendered
// and only exists when the integration is enabled: `EDITOR=dev astro dev` (or EDITOR=1) locally, and
// `EDITOR=1 astro build` for a server build. Plain `astro dev` / `astro build` leave it out.
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The editor's copy of the site serves its built pages as static files, on the editor's origin,
 * where the editor API and the session cookie live. The platform answers those before any of our
 * code runs, so the rules the middleware puts on everything else go in the static headers file
 * (Cloudflare `_headers`): the site's own scripts only, no inline event handlers, framed only here.
 */
function writeEditorHeaders(clientDir, previewScripts) {
  if (!fs.existsSync(clientDir)) return;
  const file = path.join(clientDir, '_headers');
  const scripts = previewScripts === 'all' ? "script-src-attr 'none'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; script-src-attr 'none'";
  const block = `\n# pagestack: built pages served by the editor\n/*\n  Content-Security-Policy: ${scripts}; object-src 'none'; base-uri 'self'; frame-ancestors 'self'\n  X-Frame-Options: SAMEORIGIN\n  X-Robots-Tag: noindex\n`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!existing.includes('# pagestack: built pages served by the editor')) fs.writeFileSync(file, existing + block);
}

/**
 * Cloudflare serves files in the assets directory before the Worker runs, which would put every
 * built site page on the editor's domain with no sign-in. Send everything but hashed build assets
 * through the Worker (src/worker.ts decides). Leaves a host's own `run_worker_first` alone.
 */
function routeThroughWorker(serverDir, logger) {
  const file = path.join(serverDir, 'wrangler.json');
  if (!fs.existsSync(file)) return;
  const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!conf.assets) return;
  if (conf.assets.run_worker_first === undefined) {
    conf.assets.run_worker_first = ['/*', '!/_astro/*'];
    fs.writeFileSync(file, JSON.stringify(conf));
  } else if (conf.assets.run_worker_first === false) {
    logger?.warn('wrangler assets.run_worker_first is false: built site pages on the editor are served without sign-in.');
  }
}

const VIRTUAL = 'virtual:pagestack/site';
const VIRTUAL_RENDERER = 'virtual:pagestack/renderer';
const VIRTUAL_PREVIEWS = 'virtual:pagestack/previews';
const here = path.dirname(fileURLToPath(import.meta.url));
const route = (file) => new URL(`./src/routes/${file}`, import.meta.url);

/**
 * @typedef {object} SectionEditorOptions
 * @property {string} [renderer] Astro component rendering a page: props { page, editing }. Required unless `pages: false`.
 * @property {boolean} [pages]   false for a site with no block pages: only collections, globals and media.
 * @property {Record<string, string>} [previews]  Per collection id, an Astro component that lays out one item
 *                        the way the site does: props { item: { id, collection, data, body, html, headings }, editing }.
 *                        With one, the item opens on its page and its text is edited in place.
 * @property {string} sections   Module exporting { schemas, presets } (see runtime.ts types).
 * @property {string} [pagesDir='src/content/pages']  Directory of <slug>.json pages.
 * @property {string} [imagesDir='public/images']     Browsable image library root.
 * @property {string} [uploadsDir='public/images/uploads']  Where uploads are written.
 * @property {string} [publicDir='public']            Prefix stripped to turn file paths into URLs.
 * @property {string} [usersFile='editor-users.json'] Passkey users (public keys only).
 * @property {'none'|'passkey'|'none-behind-proxy'} [auth='passkey']
 * @property {'local'|'github'} [storage]  Defaults: local in dev, github in a build.
 * @property {{repo: string, branch?: string, pullRequest?: boolean, live?: string, stagingUrl?: string}} [github]
 *   `branch` is where saves go. With `live` (the branch the public site builds from), saves stay on
 *   `branch` as staging and a Go live button puts them on `live` in one step; `stagingUrl` links to
 *   a preview of the staging branch. `pullRequest` opens a PR per save instead.
 * @property {'site'|'all'} [previewScripts='site']  Scripts in the block editor's preview: 'site' runs the site's own and blocks other origins (analytics, captchas, widgets); 'all' allows everything.
 * @property {boolean} [enabled]  Default: EDITOR=dev or EDITOR=1 (exact values: $EDITOR is also the shell's text editor). Off otherwise, in dev too.
 * @property {string} [siteName]  Shown in the editor chrome.
 * @property {string} [interactiveSelector='summary']  Elements in the preview that keep their own click
 *                        behaviour (accordion summaries, tab titles, load-map buttons…). Everything else is
 *                        intercepted so links don't navigate while editing.
 * @property {string} [secretEnv='EDITOR_SECRET']  Name of the env var holding the signing secret.
 * @property {string[]} [reservedSlugs]  Top-level URLs new pages may not take, beyond the host's own files in
 *                        src/pages, which are found automatically. For dynamic routes such as blog posts.
 * @property {string} [redirectsFile='public/_redirects']  When this file exists, moving a page appends a 301 to it.
 * @property {string} [clientIpHeader]  Header holding the client IP behind a proxy, for login rate limits (e.g. cf-connecting-ip).
 * @property {string} [patternsFile='src/content/pagestack-patterns.json']  Where saved patterns are kept.
 *
 * Runtime environment (never in the repo):
 *   EDITOR_SECRET        >= 16 chars; signs sessions, WebAuthn challenges and invite links.
 *   EDITOR_ORIGIN        Public origin (https://example.com) when the server sits behind a proxy
 *                        that rewrites Host — passkeys are bound to the origin the browser sees.
 *   GITHUB_TOKEN         Fine-grained token with contents (+ pull requests) on the repo, github storage only.
 */

/** Top-level URLs taken by the host's own route files (dynamic ones can't be known here). */
/** URL prefix of the uploads folder ('/images/uploads'), or null when uploads aren't public files or would be a site-wide catch-all. */
export function uploadsUrlPrefix(uploadsDir, publicDir) {
  const up = uploadsDir.replace(/\\/g, '/').replace(/\/+$/, ''), pub = publicDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!up.startsWith(pub + '/')) return null;
  const rest = up.slice(pub.length + 1);
  return rest && !rest.split('/').some((s) => s === '..' || s === '.' || /[[\]]/.test(s)) ? '/' + rest : null;
}

function staticRoutes(srcDir) {
  try {
    return fs.readdirSync(path.join(srcDir, 'pages'), { withFileTypes: true })
      .filter((e) => !/^[[_.]/.test(e.name) && e.name !== 'index.astro' && (e.isDirectory() || /\.(astro|md|mdx|html|js|ts)$/.test(e.name)))
      .map((e) => e.name.replace(/\.[^.]+$/, ''));
  } catch { return []; }
}

/** @param {SectionEditorOptions} userOptions */
export default function sectionEditor(userOptions) {
  if (!userOptions?.sections) throw new Error('pagestack: `sections` is required');
  if (!userOptions.renderer && userOptions.pages !== false) throw new Error('pagestack: `renderer` is required unless `pages: false`');
  // When the site has no adapter of its own we bring @astrojs/node along and forward every
  // integration hook to it (an integration added via updateConfig() doesn't get to call
  // setAdapter() in time, so we proxy its hooks instead).
  let adapter = null;
  // Set in astro:config:setup when the editor is on: page files to render on request (liveRoutes).
  let liveComponents = null;
  // Set when building the editor: the site's built pages it serves need the editor's script rules.
  let editorBuild = null;
  const forward = (hook) => async (params) => { if (adapter?.hooks?.[hook]) await adapter.hooks[hook](params); };
  const forwarded = Object.fromEntries(['astro:config:done', 'astro:server:setup', 'astro:server:start', 'astro:server:done', 'astro:build:start', 'astro:build:setup', 'astro:build:ssr', 'astro:build:generated', 'astro:build:done'].map((h) => [h, forward(h)]));
  return {
    name: 'pagestack',
    hooks: {
      ...forwarded,
      'astro:config:done': async (params) => {
        if (editorBuild) {
          editorBuild.dirs = [params.config.build.client, params.config.outDir]; // with an adapter, files go to build.client
          editorBuild.server = params.config.build.server;
          editorBuild.logger = params.logger;
        }
        await forwarded['astro:config:done'](params);
      },
      'astro:build:done': async (params) => {
        await forwarded['astro:build:done'](params);
        const dir = editorBuild?.dirs?.map((u) => fileURLToPath(u)).find((d) => fs.existsSync(d));
        if (dir) writeEditorHeaders(dir, editorBuild.previewScripts);
        if (editorBuild?.cloudflare && editorBuild.server) routeThroughWorker(fileURLToPath(editorBuild.server), editorBuild.logger);
      },
      // List pages named in `liveRoutes` render on request on the editor's server, reading what
      // has been saved. Only in the editor build: the public build never gets here.
      'astro:route:setup': ({ route }) => {
        if (liveComponents?.has(route.component.replace(/\\/g, '/'))) route.prerender = false;
      },
      'astro:config:setup': async (params) => {
        const { config, command, injectRoute, updateConfig, addMiddleware, logger } = params;
        const flag = process.env.EDITOR;
        const enabled = userOptions.enabled ?? (flag === '1' || (command === 'dev' && flag === 'dev'));
        if (!enabled) { logger.info(command === 'dev' ? 'off. Run with EDITOR=dev to edit at /edit.' : 'off (static build). Set EDITOR=1 to build the editor.'); return; }
        const isBuild = command === 'build';
        if (isBuild) editorBuild = { previewScripts: userOptions.previewScripts };
        const options = {
          pagesDir: 'src/content/pages',
          imagesDir: 'public/images',
          uploadsDir: 'public/images/uploads',
          publicDir: 'public',
          usersFile: 'editor-users.json',
          auth: 'passkey',
          storage: isBuild ? 'github' : 'local',
          siteName: 'Site editor',
          secretEnv: 'EDITOR_SECRET',
          interactiveSelector: 'summary',
          redirectsFile: 'public/_redirects',
          patternsFile: 'src/content/pagestack-patterns.json',
          ...userOptions,
          github: userOptions.github ?? null,
        };
        if (isBuild && options.auth === 'none') {
          throw new Error('pagestack: auth: "none" is only allowed in `astro dev`. Use "passkey" or "none-behind-proxy" for a build.');
        }
        if (options.storage === 'github' && !options.github?.repo) {
          throw new Error('pagestack: storage "github" needs github.repo ("owner/name")');
        }
        if (options.github?.live && options.github.live === (options.github.branch ?? 'main')) {
          throw new Error('pagestack: github.live must differ from github.branch (saves go to branch, Go live moves them to live)');
        }
        if (options.github?.live && options.github.pullRequest) {
          throw new Error('pagestack: use github.live or github.pullRequest, not both');
        }
        const root = fileURLToPath(config.root);
        const pagesRel = path.relative(root, path.join(fileURLToPath(config.srcDir), 'pages')).replace(/\\/g, '/');
        liveComponents = new Set((options.liveRoutes ?? []).flatMap((r) => {
          const base = r.replace(/^\/|\/$/g, '');
          return base ? [`${pagesRel}/${base}.astro`, `${pagesRel}/${base}/index.astro`] : [`${pagesRel}/index.astro`];
        }));
        const abs = (p) => path.isAbsolute(p) ? p : path.resolve(root, p);
        const reservedSlugs = [...new Set([...(options.reservedSlugs ?? []), ...staticRoutes(fileURLToPath(config.srcDir))])];
        const serial = { ...options, builtAt: Date.now(), reservedSlugs, root, renderer: options.renderer ? abs(options.renderer) : null, previews: Object.fromEntries(Object.entries(options.previews ?? {}).map(([k, v]) => [k, abs(v)])), sections: abs(options.sections), command };

        updateConfig({
          vite: {
            plugins: [{
              name: 'pagestack:virtual',
              enforce: 'pre',
              // A save in dev writes files the site's routes import, and Vite answers with a full
              // reload of every open page, the editor included. Drop reloads caused by the editor's
              // own writes (src/core/storage-local.ts); the editor refreshes its preview itself.
              configureServer(server) {
                const recent = () => {
                  const writes = globalThis.__PS_WRITES__;
                  if (!writes) return false;
                  const now = Date.now();
                  for (const [f, t] of writes) if (now - t > 3000) writes.delete(f);
                  return writes.size > 0;
                };
                const own = (payload) => {
                  if (payload?.type !== 'full-reload' || !recent()) return false;
                  const by = payload.triggeredBy ? path.resolve(payload.triggeredBy) : null;
                  return !by || globalThis.__PS_WRITES__.has(by) || /\.(json|md|mdx)$/.test(by);
                };
                const channels = [server.ws, ...Object.values(server.environments ?? {}).map((e) => e.hot)].filter(Boolean);
                for (const ch of new Set(channels)) {
                  const send = ch.send.bind(ch);
                  ch.send = (payload, ...rest) => { if (!own(payload)) send(payload, ...rest); };
                }
              },
              resolveId(id) {
                if (id === VIRTUAL || id === VIRTUAL_RENDERER || id === VIRTUAL_PREVIEWS) return '\0' + id;
                // On Cloudflare the editor's Worker checks site pages before the adapter (src/worker.ts).
                if (isBuild && /^@astrojs\/cloudflare\/entrypoints\/server(\.js)?$/.test(id)) {
                  editorBuild.cloudflare = true;
                  return fileURLToPath(new URL('./src/worker.ts', import.meta.url));
                }
              },
              load(id) {
                // The renderer (and the site layout/CSS behind it) is only imported by the preview
                // route, so the editor shell doesn't drag the whole site's CSS into its page.
                if (id === '\0' + VIRTUAL_RENDERER) return serial.renderer ? `export { default as Renderer } from ${JSON.stringify(serial.renderer)};` : 'export const Renderer = null;';
                // Item layouts, like the renderer, load only on the route that shows them.
                if (id === '\0' + VIRTUAL_PREVIEWS) {
                  const entries = Object.entries(serial.previews);
                  return [...entries.map(([, file], i) => `import P${i} from ${JSON.stringify(file)};`), `export const previews = { ${entries.map(([k], i) => `${JSON.stringify(k)}: P${i}`).join(', ')} };`].join('\n');
                }
                if (id !== '\0' + VIRTUAL) return;
                return [
                  `export * as site from ${JSON.stringify(serial.sections)};`,
                  `export const options = ${JSON.stringify(serial)};`,
                ].join('\n');
              },
            }],
            // The package is consumed from source (.ts/.astro); make sure Vite transforms it.
            ssr: { noExternal: ['@pirateandfox/pagestack'] },
            // Pre-bundle the editor's browser deps so dev doesn't re-optimise (and reload) mid-session.
            optimizeDeps: { include: ['sortablejs', '@simplewebauthn/browser', 'marked'] },
          },
        });
        if (!config.adapter) {
          adapter = node({ mode: 'standalone' });
          await adapter.hooks['astro:config:setup']?.(params);
          // Astro's build checks `config.adapter`; integrations added this late aren't hooked
          // up automatically, hence the forwarded hooks above.
          updateConfig({ adapter });
        }

        addMiddleware({ order: 'pre', entrypoint: new URL('./src/server/middleware.ts', import.meta.url) });

        injectRoute({ pattern: '/edit', entrypoint: route('edit-index.astro'), prerender: false });
        injectRoute({ pattern: '/edit/login', entrypoint: route('login.astro'), prerender: false });
        injectRoute({ pattern: '/edit/enroll', entrypoint: route('enroll.astro'), prerender: false });
        injectRoute({ pattern: '/edit/preview/[...slug]', entrypoint: route('preview.astro'), prerender: false });
        injectRoute({ pattern: '/edit/preview-item/[id]/[...slug]', entrypoint: route('preview-item.astro'), prerender: false });
        injectRoute({ pattern: '/edit/global/[id]', entrypoint: route('edit-global.astro'), prerender: false });
        injectRoute({ pattern: '/edit/collection/[id]', entrypoint: route('edit-collection.astro'), prerender: false });
        injectRoute({ pattern: '/edit/collection/[id]/[...slug]', entrypoint: route('edit-item.astro'), prerender: false });
        injectRoute({ pattern: '/edit/site', entrypoint: route('edit-site.astro'), prerender: false });
        injectRoute({ pattern: '/edit/media', entrypoint: route('edit-media.astro'), prerender: false });
        injectRoute({ pattern: '/edit/users', entrypoint: route('edit-users.astro'), prerender: false });
        injectRoute({ pattern: '/edit/[...slug]', entrypoint: route('edit-page.astro'), prerender: false });
        injectRoute({ pattern: '/api/editor/pages', entrypoint: route('api/pages.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/page/[...slug]', entrypoint: route('api/page.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/patterns', entrypoint: route('api/patterns.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/global/[id]', entrypoint: route('api/global.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/images', entrypoint: route('api/images.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/collection/[id]/[...slug]', entrypoint: route('api/collection.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/users', entrypoint: route('api/users.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/browse', entrypoint: route('api/browse.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/live', entrypoint: route('api/live.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/samples', entrypoint: route('api/samples.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/auth/[action]', entrypoint: route('api/auth.ts'), prerender: false });
        // Uploads saved after this editor was built aren't static files in it; serve them from the repo.
        const uploadsUrl = options.storage === 'github' && uploadsUrlPrefix(options.uploadsDir, options.publicDir);
        if (uploadsUrl) injectRoute({ pattern: `${uploadsUrl}/[...path]`, entrypoint: route('uploaded.ts'), prerender: false });
        logger.info(`enabled — storage: ${options.storage}, auth: ${options.auth}. Open /edit`);
      },
    },
  };
}
