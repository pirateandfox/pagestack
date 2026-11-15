import { describe, expect, it } from 'vitest';
import { isSampleItem, planDelete, planHide, sampleState, type SampleItem, type SamplePage } from '../src/core/samples';
import { parseMarkdown } from '../src/core/frontmatter';

const pagePath = (s: string) => `pages/${s}.json`;
const page = (slug: string, extra: object = {}): SamplePage => {
  const doc = { title: slug, sample: true, sections: [], ...extra } as any;
  return { slug, path: pagePath(slug), raw: JSON.stringify(doc), page: doc };
};
const item = (slug: string, draft = false): SampleItem => {
  const raw = `---\ntitle: ${slug}\nsample: true${draft ? '\ndraft: true' : ''}\n---\nBody of ${slug}\n`;
  return { collection: 'articles', label: 'Journal', slug, path: `articles/${slug}.md`, raw, title: slug, draft };
};
const globals = [{ id: 'site', path: 'site.json', raw: JSON.stringify({ name: 'Meridian', announcement: 'Open evening' }) }];
const config = { home: { title: 'Home', sections: [] }, globals: { site: { announcement: '' } } };
const input = (pages: SamplePage[], items: SampleItem[]) => ({ pages, items, globals, config, pagePath, taken: ['index', 'about', ...pages.map((p) => p.slug)] });

describe('sampleState', () => {
  it('none, shown, hidden', () => {
    expect(sampleState([], [])).toBe('none');
    expect(sampleState([page('index')], [])).toBe('shown'); // a sample home page is always on the site
    expect(sampleState([page('ref', { status: 'draft' })], [item('a')])).toBe('shown');
    expect(sampleState([page('ref', { status: 'draft' })], [item('a', true)])).toBe('hidden');
  });
  it('reads the mark from frontmatter', () => {
    expect(isSampleItem(item('a').raw)).toBe(true);
    expect(isSampleItem('---\ntitle: mine\n---\n')).toBe(false);
  });
});

describe('planHide', () => {
  const plan = planHide(input([page('index'), page('about'), page('ref', { status: 'draft' })], [item('a'), item('b', true)]));
  const file = (p: string) => plan.files.find((f) => f.path === p)?.content as string;
  it('moves the home page to a draft and puts the replacement in its place', () => {
    const moved = JSON.parse(file('pages/sample-home.json'));
    expect(moved).toMatchObject({ title: 'Sample: index', status: 'draft', sample: true });
    expect(JSON.parse(file('pages/index.json'))).toEqual({ title: 'Home', sections: [] });
    expect(plan.expect['pages/sample-home.json']).toBeNull();
  });
  it('drafts the rest, leaves drafts alone, deletes nothing', () => {
    expect(JSON.parse(file('pages/about.json'))).toMatchObject({ status: 'draft', sample: true });
    expect(file('pages/ref.json')).toBeUndefined();
    expect(parseMarkdown(file('articles/a.md'))).toEqual({ data: { title: 'a', sample: true, draft: true }, body: 'Body of a\n' });
    expect(file('articles/b.md')).toBeUndefined();
    expect(plan.deletes).toEqual([]);
    expect([plan.pages, plan.items]).toEqual([2, 1]);
  });
  it('resets the globals the host names, and checks every file it read', () => {
    expect(JSON.parse(file('site.json'))).toEqual({ name: 'Meridian', announcement: '' });
    expect(Object.keys(plan.expect).sort()).toEqual(['articles/a.md', 'pages/about.json', 'pages/index.json', 'pages/sample-home.json', 'site.json']);
  });
  it('picks a free slug when sample-home is taken', () => {
    const p = planHide({ ...input([page('index')], []), taken: ['index', 'sample-home'] });
    expect(p.files.map((f) => f.path)).toContain('pages/sample-home-2.json');
  });
  it('a second run does nothing', () => {
    const p = planHide({ ...input([page('sample-home', { status: 'draft' })], [item('a', true)]), globals: [{ id: 'site', path: 'site.json', raw: JSON.stringify({ announcement: '' }) }] });
    expect([p.files, p.deletes]).toEqual([[], []]);
  });
});

describe('planDelete', () => {
  it('deletes every sample, replaces a sample home page, keeps the rest', () => {
    const plan = planDelete(input([page('index'), page('about'), page('sample-home', { status: 'draft' })], [item('a'), item('b', true)]));
    expect(plan.deletes.sort()).toEqual(['articles/a.md', 'articles/b.md', 'pages/about.json', 'pages/sample-home.json']);
    expect(plan.files.map((f) => f.path)).toEqual(['pages/index.json', 'site.json']);
    expect([plan.pages, plan.items]).toEqual([3, 2]);
  });
});
