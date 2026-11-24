import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '../src/core/frontmatter';

// The API refuses what would break the site's build, whatever the form sent.
const files = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('virtual:pagestack/site', () => ({
  options: { root: '/', pagesDir: 'pages', patternsFile: 'patterns.json', redirectsFile: 'r', reservedSlugs: [], secretEnv: 'X', storage: 'local', github: null },
  site: {
    presets: [],
    schemas: { hero: { label: 'Hero', fields: { title: { type: 'text', label: 'Title', required: true } } } },
    globals: { site: { label: 'Site', file: 'site.json', fields: { name: { type: 'text', label: 'Name', required: true }, theme: { type: 'select', label: 'Theme', required: true, options: [{ value: 'light', label: 'Light' }] } } } },
    collections: { studies: { label: 'Studies', dir: 'studies', fields: {
      title: { type: 'text', label: 'Title' }, date: { type: 'date', label: 'Date', time: false, required: true }, year: { type: 'number', label: 'Year', required: true },
      kind: { type: 'select', label: 'Kind', required: true, options: [{ value: 'trial', label: 'Trial' }] }, size: { type: 'number', label: 'Size' }, draft: { type: 'boolean', label: 'Draft' },
    } } },
  },
}));
vi.mock('../src/core/storage-local', () => ({ LocalStorage: class {
  kind = 'local';
  async readFile(p: string) { return files[p] ?? null; }
  async readDirs(dirs: string[]) { return Object.fromEntries(dirs.map((d) => [d, Object.keys(files).filter((f) => f.startsWith(d + '/')).map((f) => ({ name: f.slice(d.length + 1), content: files[f] }))])); }
  async commit(o: any) { for (const f of o.files) files[f.path] = f.content; return { kind: 'local', files: o.files.map((f: any) => f.path) }; }
} }));
const collection = await import('../src/routes/api/collection');
const global = await import('../src/routes/api/global');
const pageApi = await import('../src/routes/api/page');
const patterns = await import('../src/routes/api/patterns');
const call = async (fn: any, params: object, body: object, method = 'PUT') => {
  const res: Response = await fn({ params, locals: {}, url: new URL('http://x'), request: new Request('http://x', { method, body: JSON.stringify(body) }) });
  return { status: res.status, ...(await res.json()) };
};
const study = '---\ntitle: One\ndate: 2026-01-01\nyear: 2020\nkind: trial\nsize: 40\n---\nBody\n';
beforeEach(() => { for (const k of Object.keys(files)) delete files[k]; });

describe('collections', () => {
  const put = (data: object) => call(collection.PUT, { id: 'studies', slug: 'one' }, { data, body: 'Body\n' });
  beforeEach(() => { files['studies/one.md'] = study; });

  it('refuse a cleared required field and write nothing', async () => {
    expect(await put({ title: 'One', date: '', year: '', kind: 'trial' })).toMatchObject({ status: 400, error: 'Fill in Date and Year.' });
    expect(await put({ title: 'One', date: '', draft: true })).toMatchObject({ status: 400 }); // Astro checks drafts too
    expect(files['studies/one.md']).toBe(study);
  });
  it('clear an optional number', async () => {
    expect(await put({ title: 'One', size: '' })).toMatchObject({ status: 200 });
    expect(parseMarkdown(files['studies/one.md']).data).toEqual({ title: 'One', date: '2026-01-01', year: 2020, kind: 'trial' });
  });
  it('write a required value the form displayed but the file lacked', async () => {
    files['studies/one.md'] = study.replace('kind: trial\n', '');
    expect(await put({ title: 'Two' })).toMatchObject({ status: 200 });
    expect(parseMarkdown(files['studies/one.md']).data).toMatchObject({ title: 'Two', kind: 'trial' });
  });
  it('a save that changes nothing is still no change', async () => {
    expect(await put({ title: 'One', year: 2020 })).toMatchObject({ unchanged: true });
  });

  it('add an item only with everything the build needs', async () => {
    const post = (extra: object) => call(collection.POST, { id: 'studies' }, { title: 'New', slug: 'new', ...extra }, 'POST');
    expect(await post({})).toMatchObject({ status: 400, error: 'Fill in Year.' });
    expect(files['studies/new.md']).toBeUndefined();
    expect(await post({ data: { year: 2026, title: 'Other', draft: false, nonsense: 1 } })).toMatchObject({ status: 201 });
    expect(parseMarkdown(files['studies/new.md']).data).toEqual({ title: 'New', date: new Date().toISOString().slice(0, 10), year: 2026, kind: 'trial', draft: true });
  });
});

it('globals', async () => {
  files['site.json'] = '{"name":"Old","other":1}';
  expect(await call(global.PUT, { id: 'site' }, { doc: { name: ' ' } })).toMatchObject({ status: 400, error: 'Fill in Name.' });
  expect(await call(global.PUT, { id: 'site' }, { doc: { name: 'New' } })).toMatchObject({ status: 200 });
  expect(JSON.parse(files['site.json'])).toEqual({ name: 'New', other: 1, theme: 'light' });
});

describe('pages', () => {
  const doc = (title: string, extra = {}) => ({ title: 'P', sections: [{ id: 'a', type: 'hero', settings: { title } }], ...extra });
  it('are refused on the site, not as drafts', async () => {
    files['pages/p.json'] = JSON.stringify(doc('x'));
    const put = (page: object) => call(pageApi.PUT, { slug: 'p' }, { page });
    expect(await put(doc(''))).toMatchObject({ status: 400, error: 'Fill in Hero: Title.' });
    expect(await put(doc('', { status: 'draft' }))).toMatchObject({ status: 200 });
    expect(await put(doc(''))).toMatchObject({ status: 400 }); // publishing that draft
    expect(await put(doc('y'))).toMatchObject({ status: 200 });
  });
  it('are not emptied through a synced pattern', async () => {
    const node = { id: 'n', type: 'hero', settings: { title: 'x' } };
    files['patterns.json'] = JSON.stringify([{ id: 'pat', label: 'Pat', synced: true, node }]);
    files['pages/p.json'] = JSON.stringify({ title: 'P', sections: [{ ...node, synced: 'pat' }] });
    expect(await call(patterns.PUT, {}, { id: 'pat', node: { ...node, settings: { title: '' } } })).toMatchObject({ status: 400, error: 'P: Fill in Hero: Title.' });
  });
});
