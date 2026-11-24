import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGitHub } from './fake-github';

// Cloudflare's free plan allows 50 requests per page. A site with more files than that must still open.
vi.mock('virtual:pagestack/site', () => ({
  options: {
    root: '/', pagesDir: 'src/content/pages', publicDir: 'public', imagesDir: 'public/images', uploadsDir: 'public/images/uploads', patternsFile: 'src/data/patterns.json', reservedSlugs: [], secretEnv: 'X',
    storage: 'github', github: { repo: 'o/r', branch: 'develop' },
  },
  site: {
    schemas: { note: { label: 'Note', fields: { text: { type: 'text', label: 'Text' } } } }, presets: [],
    globals: { site: { label: 'Site', file: 'src/data/site.json', fields: {} } },
    collections: { posts: { label: 'Posts', dir: 'src/content/posts', fields: {} }, news: { label: 'News', dir: 'src/content/news', fields: {} } },
    sampleContent: { globals: { site: {} } },
  },
}));

const pad = (i: number) => String(i).padStart(3, '0');
const page = (title: string, extra = {}) => JSON.stringify({ title, sections: [], ...extra });
const files: Record<string, string | null> = {
  'src/data/site.json': '{"logo":"/img/logo.png"}',
  'src/content/pages/index.json': page('Home', { sample: true }),
  'src/content/pages/a/b/c/d/deep.json': page('Deep', { status: 'draft', image: '/img/logo.png' }),
  'src/content/pages/a/b/c/d/e/too-deep.json': page('Too deep'),
  'src/content/pages/notes.txt': 'not a page',
  'src/content/news/one.md': '---\ntitle: One\nsample: true\n---\n',
};
for (let i = 0; i < 80; i++) files[`src/content/pages/${i % 2 ? `s${i}/` : ''}p${pad(i)}.json`] = page(`Page ${i}`);
for (let i = 0; i < 120; i++) files[`src/content/posts/p${pad(i)}.md`] = `---\ntitle: Post ${i}\ndate: 2026-01-01\ndraft: ${i === 3}\n---\n`;

const LIMIT = 50;
let gh = fakeGitHub(files, { limit: LIMIT });
vi.stubGlobal('fetch', (...a: Parameters<typeof fetch>) => gh.fetch(...a));
process.env.GITHUB_TOKEN = 't';
const { collections, listItems, listPages, readPages, readSamples, whereUsed } = await import('../src/server/context');
const collectionApi = await import('../src/routes/api/collection');
const imagesApi = await import('../src/routes/api/images');
const patternsApi = await import('../src/routes/api/patterns');
const samplesApi = await import('../src/routes/api/samples');
const call = (body: unknown, method = 'POST') => ({ params: {}, locals: {}, request: new Request('http://x', { method, body: JSON.stringify(body) }) }) as any;

// The second run is GitHub failing on whole folders, so everything is read in batches.
describe.each([['one request per folder read', undefined], ['in batches', 502]])('more files than requests: %s', (_, folderQueries) => {
  beforeEach(() => { gh = fakeGitHub(files, { limit: LIMIT, folderQueries }); });

  it('the Pages screen: every page in subfolders, and the samples', async () => {
    const [pages, samples] = await (async (stored) => Promise.all([listPages(stored), readSamples(stored)]))(readPages()); // as edit-index.astro
    expect(pages).toHaveLength(82);
    expect(pages[0]).toEqual({ slug: 'index', title: 'Home', sections: 0, status: 'published', sample: true });
    expect(pages.find((p) => p.slug === 'a/b/c/d/deep')).toEqual({ slug: 'a/b/c/d/deep', title: 'Deep', sections: 0, status: 'draft' });
    expect(pages.map((p) => p.slug)).toContain('s1/p001');
    expect(samples.pages.map((p) => p.path)).toEqual(['src/content/pages/index.json']);
    expect(samples.pages[0].raw).toBe(files['src/content/pages/index.json']);
    expect(samples.items).toMatchObject([{ collection: 'news', slug: 'one', title: 'One', draft: false }]);
    expect(samples.slugs).toHaveLength(82);
    expect(samples.globals).toEqual([{ id: 'site', path: 'src/data/site.json', raw: files['src/data/site.json'] }]);
    if (!folderQueries) expect(gh.urls()).toHaveLength(3); // pages, collections, the global
  });

  it('a collection screen', async () => {
    const items = await listItems(collections.posts);
    expect(items).toHaveLength(120);
    expect(items[3]).toEqual({ slug: 'p003', title: 'Post 3', date: '2026-01-01', draft: true });
    if (!folderQueries) expect(gh.urls()).toEqual(['/graphql']);
  });

  it('adding an item, which checks the URL against every page and item', async () => {
    const post = (slug: string) => collectionApi.POST({ params: { id: 'posts' }, locals: {}, request: new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 'T', slug }) }) } as any) as Promise<Response>;
    expect((await post('p119')).status).toBe(409);
    gh.newPage();
    expect((await post('p002')).status).toBe(409);
  });

  it('where an image is used', async () => {
    expect(await whereUsed('/img/logo.png')).toEqual([{ title: 'Deep', href: '/edit/a/b/c/d/deep' }, { title: 'Site', href: '/edit/global/site' }]);
    if (!folderQueries) expect(gh.urls()).toHaveLength(2); // pages, globals and patterns
  });
});

describe('saving many files', () => {
  it.each(['hide', 'delete'])('%s sample content', async (action) => {
    const many: Record<string, string | null> = { 'src/data/site.json': '{}', 'src/content/pages/index.json': page('Home', { sample: true }) };
    for (let i = 0; i < 60; i++) {
      many[`src/content/pages/sub/p${pad(i)}.json`] = page(`Page ${i}`, { sample: true });
      many[`src/content/posts/p${pad(i)}.md`] = `---\ntitle: Post ${i}\nsample: true\n---\nText\n`;
    }
    gh = fakeGitHub(many, { limit: LIMIT });
    const res = await samplesApi.POST(call({ action })) as Response;
    expect(await res.json()).toMatchObject({ ok: true, pages: 61, items: 60 });
    expect(gh.saved().filter((f: any) => f.path.startsWith('src/content/posts/'))).toHaveLength(60);
    if (action === 'hide') expect(gh.saved().find((f: any) => f.path === 'src/content/posts/p007.md').content).toContain('draft: true');
    expect(gh.urls().length).toBeLessThan(20);
  });

  it('writes nothing when one of many files changed meanwhile', async () => {
    const many: Record<string, string | null> = {};
    for (let i = 0; i < 70; i++) many[`src/content/posts/p${pad(i)}.md`] = `---\ntitle: ${i}\nsample: true\n---\n`;
    gh = fakeGitHub(many, { limit: LIMIT });
    const real = gh.fetch;
    gh.fetch = (async (u: any, init: any) => {
      if (String(init?.body).includes('"ref"')) many['src/content/posts/p066.md'] = 'edited by someone else';
      return real(u, init);
    }) as typeof fetch;
    expect((await samplesApi.POST(call({ action: 'delete' })) as Response).status).toBe(409);
    expect(gh.saved()).toBeNull();
  });

  it('a synced pattern on every page', async () => {
    const node = { id: 'n', type: 'note', settings: { text: 'old' } };
    const many: Record<string, string | null> = { 'src/data/patterns.json': JSON.stringify([{ id: 'pat', label: 'Note', synced: true, node }]) };
    for (let i = 0; i < 80; i++) many[`src/content/pages/p${pad(i)}.json`] = JSON.stringify({ title: `P${i}`, sections: [{ ...node, id: `n${i}`, synced: 'pat' }] });
    gh = fakeGitHub(many, { limit: LIMIT });
    const res = await patternsApi.PUT(call({ id: 'pat', node: { ...node, settings: { text: 'new' } } }, 'PUT')) as Response;
    expect((await res.json()).pages).toHaveLength(80);
    expect(gh.saved()).toHaveLength(81);
    expect(gh.saved().find((f: any) => f.path === 'src/content/pages/p042.json').content).toContain('"new"');
    expect(gh.urls().length).toBeLessThan(15);
  });
});

describe('the media library', () => {
  const images: Record<string, string | null> = { 'public/images/logo.png': null, 'public/images/readme.txt': 'x' };
  for (let y = 2000; y < 2040; y++) for (const m of ['01', '02']) images[`public/images/${y}/${m}/a.jpg`] = null;
  const uploads = ['public/images/uploads/new.png', 'public/images/logo.png'];
  const list = async () => (await (await imagesApi.GET({ url: new URL('http://x/?limit=2000') } as any) as Response).json()).images.map((i: any) => i.src);

  it('lists any number of folders, newest first, with what is waiting', async () => {
    gh = fakeGitHub(images, { limit: LIMIT, uploads });
    const srcs = await list();
    expect(srcs).toHaveLength(82);
    expect(srcs.slice(0, 3)).toEqual(['/images/uploads/new.png', '/images/2039/02/a.jpg', '/images/2039/01/a.jpg']);
    expect(srcs.at(-1)).toBe('/images/logo.png');
    expect(gh.urls().length).toBeLessThanOrEqual(5);
  });

  it('goes folder by folder when GitHub cuts the listing short', async () => {
    gh = fakeGitHub(images, { limit: LIMIT, uploads, cutListings: ['public/images'] });
    expect(await list()).toHaveLength(82);
  });
});

it('the fake does refuse request 51', async () => {
  gh = fakeGitHub(files, { limit: LIMIT });
  for (let i = 0; i < LIMIT; i++) await gh.fetch('https://api.github.com/repos/o/r/contents/x');
  await expect(gh.fetch('https://api.github.com/repos/o/r/contents/x')).rejects.toThrow('Too many subrequests');
});
