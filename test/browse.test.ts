import { beforeEach, describe, expect, it, vi } from 'vitest';

// The editor's server context, reduced to what Browse reads.
const state = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  opts: { pages: true as boolean, renderer: '/site/Page.astro' as string | null, previews: { articles: 'x' } as Record<string, string>, liveRoutes: ['/', '/articles'] as string[] },
}));
vi.mock('../src/server/context', () => ({
  opts: state.opts,
  slugRe: /^[a-z0-9][a-z0-9/_-]*$/i,
  collections: {
    articles: { label: 'Articles', dir: 'src/content/articles', fields: {}, url: (s: string) => `/articles/${s}/` },
    pages: { label: 'Pages', dir: 'src/content/pages', fields: {}, url: (s: string) => `/${s}/` },
    docs: { label: 'Docs', dir: 'src/content/docs', fields: {}, url: (s: string) => `/docs/${s}.html` },
  },
  storage: () => ({ readFile: async (p: string) => state.files[p] ?? null }),
  readPage: async (slug: string) => {
    const raw = state.files[`src/content/pages/${slug}.json`];
    return raw ? { page: JSON.parse(raw), hash: 'h', raw } : null;
  },
}));

const { normalizePath, isLiveRoute, resolve } = await import('../src/server/browse');

beforeEach(() => {
  state.files = {};
  Object.assign(state.opts, { pages: true, renderer: '/site/Page.astro', previews: { articles: 'x' }, liveRoutes: ['/', '/articles'] });
});

describe('Browse: site paths', () => {
  it('keeps only the path, and never leaves the site', () => {
    expect(normalizePath('/articles/x/?utm=1#top')).toBe('/articles/x/');
    expect(normalizePath(null)).toBe('/');
    expect(normalizePath('//evil.example/x')).toBe('/x');
    expect(normalizePath('https://evil.example/a/')).toBe('/a/');
  });

  it('matches live routes with or without the trailing slash, and nothing below them', () => {
    expect(isLiveRoute('/')).toBe(true);
    expect(isLiveRoute('/articles')).toBe(true);
    expect(isLiveRoute('/articles/')).toBe(true);
    expect(isLiveRoute('/articles/index.html')).toBe(true);
    expect(isLiveRoute('/articles/one/')).toBe(false);
    expect(isLiveRoute('/news/')).toBe(false);
  });
});

describe('Browse: what a path shows and edits', () => {
  it('shows an item through its preview, the latest saved version, and edits it', async () => {
    state.files['src/content/articles/one.md'] = '---\ntitle: "First one"\n---\nHi';
    expect(await resolve('/articles/one/')).toEqual({
      path: '/articles/one/', kind: 'item',
      frame: '/edit/preview-item/articles/one?view=1',
      edit: '/edit/collection/articles/one', label: 'First one',
    });
  });

  it('shows an item without a preview as the built copy, still with Edit', async () => {
    state.files['src/content/pages/about.md'] = '---\ntitle: About\n---\n';
    state.opts.pages = false; // a site whose pages are a Markdown collection
    expect(await resolve('/about/')).toMatchObject({ kind: 'snapshot', frame: '/about/', edit: '/edit/collection/pages/about' });
  });

  it('understands url patterns with something after the slug', async () => {
    state.files['src/content/docs/setup.md'] = '---\ntitle: Setup\n---\n';
    expect(await resolve('/docs/setup.html')).toMatchObject({ edit: '/edit/collection/docs/setup' });
  });

  it('shows an editor page through its preview', async () => {
    state.files['src/content/pages/index.json'] = JSON.stringify({ title: 'Home', sections: [] });
    state.files['src/content/pages/golf.json'] = JSON.stringify({ title: 'Golf', sections: [] });
    expect(await resolve('/')).toMatchObject({ kind: 'page', frame: '/edit/preview/index?view=1', edit: '/edit/index', label: 'Home' });
    expect(await resolve('/golf/')).toMatchObject({ kind: 'page', frame: '/edit/preview/golf?view=1', edit: '/edit/golf' });
  });

  it('a list page in liveRoutes renders itself; anything else is the built copy with no editor', async () => {
    expect(await resolve('/articles/')).toEqual({ path: '/articles/', kind: 'live', frame: '/articles/', edit: null });
    expect(await resolve('/listen/')).toEqual({ path: '/listen/', kind: 'snapshot', frame: '/listen/', edit: null });
  });

  it('an address that looks like an item but has no file is not editable', async () => {
    expect(await resolve('/articles/missing/')).toMatchObject({ kind: 'snapshot', edit: null });
  });

  it('never offers a page preview without a renderer', async () => {
    state.files['src/content/pages/golf.json'] = JSON.stringify({ title: 'Golf', sections: [] });
    state.opts.renderer = null;
    expect(await resolve('/golf/')).toMatchObject({ kind: 'snapshot', edit: null });
  });
});
