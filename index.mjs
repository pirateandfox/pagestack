// astro-section-editor — a git-only visual section editor that ships inside an Astro site.
//
//   import sectionEditor from 'astro-section-editor';
//   integrations: [sectionEditor({ renderer: './src/components/SectionPage.astro', sections: './src/sections/index.ts' })]
//
// The public site stays fully static. The editor (/edit/*, /api/editor/*) is on-demand rendered
// and only exists when the integration is enabled: always in `astro dev`, and in `astro build`
// when EDITOR=1 (which produces a Node server build with @astrojs/node).
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const VIRTUAL = 'virtual:astro-section-editor/site';
const VIRTUAL_RENDERER = 'virtual:astro-section-editor/renderer';
const here = path.dirname(fileURLToPath(import.meta.url));
const route = (file) => new URL(`./src/routes/${file}`, import.meta.url);

/**
 * @typedef {object} SectionEditorOptions
 * @property {string} renderer   Astro component rendering a page: props { page, editing }.
 * @property {string} sections   Module exporting { schemas, presets } (see runtime.ts types).
 * @property {string} [pagesDir='src/content/pages']  Directory of <slug>.json pages.
 * @property {string} [imagesDir='public/images']     Browsable image library root.
 * @property {string} [uploadsDir='public/images/uploads']  Where uploads are written.
 * @property {string} [publicDir='public']            Prefix stripped to turn file paths into URLs.
 * @property {string} [usersFile='editor-users.json'] Passkey users (public keys only).
 * @property {'none'|'passkey'|'none-behind-proxy'} [auth='passkey']
 * @property {'local'|'github'} [storage]  Defaults: local in dev, github in a build.
 * @property {{repo: string, branch?: string, pullRequest?: boolean}} [github]
 * @property {boolean} [enabled]  Default: dev, or EDITOR=1.
 * @property {string} [siteName]  Shown in the editor chrome.
 * @property {string} [secretEnv='EDITOR_SECRET']  Name of the env var holding the signing secret.
 *
 * Runtime environment (never in the repo):
 *   EDITOR_SECRET        >= 16 chars; signs sessions, WebAuthn challenges and invite links.
 *   EDITOR_ORIGIN        Public origin (https://example.com) when the server sits behind a proxy
 *                        that rewrites Host — passkeys are bound to the origin the browser sees.
 *   GITHUB_TOKEN         Fine-grained token with contents (+ pull requests) on the repo, github storage only.
 */

/** @param {SectionEditorOptions} userOptions */
export default function sectionEditor(userOptions) {
  if (!userOptions?.renderer || !userOptions?.sections) throw new Error('astro-section-editor: `renderer` and `sections` are required');
  // When the site has no adapter of its own we bring @astrojs/node along and forward every
  // integration hook to it (an integration added via updateConfig() doesn't get to call
  // setAdapter() in time, so we proxy its hooks instead).
  let adapter = null;
  const forward = (hook) => async (params) => { if (adapter?.hooks?.[hook]) await adapter.hooks[hook](params); };
  const forwarded = Object.fromEntries(['astro:config:done', 'astro:server:setup', 'astro:server:start', 'astro:server:done', 'astro:build:start', 'astro:build:setup', 'astro:build:ssr', 'astro:build:generated', 'astro:build:done'].map((h) => [h, forward(h)]));
  return {
    name: 'astro-section-editor',
    hooks: {
      ...forwarded,
      'astro:config:setup': async (params) => {
        const { config, command, injectRoute, updateConfig, addMiddleware, logger } = params;
        const enabled = userOptions.enabled ?? (command === 'dev' || process.env.EDITOR === '1');
        if (!enabled) { logger.info('disabled (static build). Set EDITOR=1 to build the editor.'); return; }
        const isBuild = command === 'build';
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
          ...userOptions,
          github: userOptions.github ?? null,
        };
        if (isBuild && options.auth === 'none') {
          throw new Error('astro-section-editor: auth: "none" is only allowed in `astro dev`. Use "passkey" or "none-behind-proxy" for a build.');
        }
        if (options.storage === 'github' && !options.github?.repo) {
          throw new Error('astro-section-editor: storage "github" needs github.repo ("owner/name")');
        }
        const root = fileURLToPath(config.root);
        const abs = (p) => path.isAbsolute(p) ? p : path.resolve(root, p);
        const serial = { ...options, root, renderer: abs(options.renderer), sections: abs(options.sections), command };

        updateConfig({
          vite: {
            plugins: [{
              name: 'astro-section-editor:virtual',
              resolveId(id) { if (id === VIRTUAL || id === VIRTUAL_RENDERER) return '\0' + id; },
              load(id) {
                // The renderer (and the site layout/CSS behind it) is only imported by the preview
                // route, so the editor shell doesn't drag the whole site's CSS into its page.
                if (id === '\0' + VIRTUAL_RENDERER) return `export { default as Renderer } from ${JSON.stringify(serial.renderer)};`;
                if (id !== '\0' + VIRTUAL) return;
                return [
                  `export * as site from ${JSON.stringify(serial.sections)};`,
                  `export const options = ${JSON.stringify(serial)};`,
                ].join('\n');
              },
            }],
            // The package is consumed from source (.ts/.astro); make sure Vite transforms it.
            ssr: { noExternal: ['astro-section-editor'] },
            // Pre-bundle the editor's browser deps so dev doesn't re-optimise (and reload) mid-session.
            optimizeDeps: { include: ['sortablejs', '@simplewebauthn/browser'] },
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
        injectRoute({ pattern: '/edit/[...slug]', entrypoint: route('edit-page.astro'), prerender: false });
        injectRoute({ pattern: '/api/editor/pages', entrypoint: route('api/pages.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/page/[...slug]', entrypoint: route('api/page.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/images', entrypoint: route('api/images.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/asset/[...path]', entrypoint: route('api/asset.ts'), prerender: false });
        injectRoute({ pattern: '/api/editor/auth/[action]', entrypoint: route('api/auth.ts'), prerender: false });
        logger.info(`enabled — storage: ${options.storage}, auth: ${options.auth}. Open /edit`);
      },
    },
  };
}
