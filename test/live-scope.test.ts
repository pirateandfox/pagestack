import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveEntries } from '../live.mjs';

// Stored entries belong to the editor's own requests. In dev the same process runs the site's
// getStaticPaths, where they would blank every post page.
const opts = vi.hoisted(() => ({ auth: 'none', storage: 'local', command: 'dev', secretEnv: 'X', liveRoutes: ['/journal'] }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
vi.mock('../src/server/context', () => ({
  opts,
  collections: { posts: { label: 'Posts', dir: 'posts', fields: {} } },
  storage: () => ({ readDir: async () => [{ name: 'a.md', content: '---\ntitle: Stored\n---\n' }] }),
}));
const { onRequest } = await import('../src/server/middleware');
const { withLive } = await import('../src/server/live');

const titles = async () => (await liveEntries('posts'))?.map((e) => e.data.title) ?? null;
const tick = () => new Promise((r) => setTimeout(r, 5));
/** What `liveEntries` gives a page at `path`, read while it renders. */
async function during(path: string, init: { isPrerendered?: boolean } = {}) {
  let seen: unknown;
  await (onRequest as any)(
    { url: new URL(`http://x${path}`), request: new Request(`http://x${path}`), isPrerendered: false, locals: {}, ...init },
    async () => { await tick(); seen = await titles(); return new Response('ok'); },
  );
  return seen;
}

beforeEach(() => { delete (globalThis as any).__PS_LIVE__; delete (globalThis as any).__PS_LIVE_SCOPE__; });

describe('where stored entries show', () => {
  it('on live pages, the editor and its previews', async () => {
    for (const p of ['/journal', '/journal/', '/edit', '/edit/preview/index', '/edit/preview-item/posts/a']) expect(await during(p), p).toEqual(['Stored']);
  });

  it('nowhere else, whatever was opened first', async () => {
    for (const first of ['/journal/', '/edit', '/edit/preview/index']) {
      await during(first);
      expect(await titles(), 'getStaticPaths, before any page renders').toBeNull();
      expect(await during('/journal/a/', { isPrerendered: true })).toBeNull();
      expect(await during('/other/')).toBeNull();
    }
  });

  it('not in another request running at the same time', async () => {
    const [live, other, still] = await Promise.all([during('/journal/'), during('/journal/a/', { isPrerendered: true }), during('/edit')]);
    expect([live, other, still]).toEqual([['Stored'], null, ['Stored']]);
  });

  it('in the parts of a page still rendering after the response has started', async () => {
    const seen: unknown[] = [];
    const render = async () => { await tick(); seen.push(await titles()); await tick(); seen.push(await titles()); };
    let done!: Promise<void>;
    withLive(() => { done = render(); return new Response('ok'); });
    expect(await titles()).toBeNull();
    await done;
    expect(seen).toEqual([['Stored'], ['Stored']]);
  });

  it('after a dev restart loads this code again', async () => {
    await during('/journal/');
    vi.resetModules();
    const again = await import('../src/server/live');
    expect(await again.withLive(titles)).toEqual(['Stored']);
    expect(await during('/journal/')).toEqual(['Stored']);
  });
});
