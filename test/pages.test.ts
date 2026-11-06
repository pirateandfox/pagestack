import { describe, expect, it } from 'vitest';
import { addRedirect, copyPage, newPage, publicPath, slugProblem, slugify, uniqueSlug } from '../src/core/pages';
import { staticPages } from '../src/runtime';
import type { PageDoc } from '../src/runtime';

describe('slugify', () => {
  it('makes URL words from a title', () => {
    expect(slugify('Summer Camp 2026')).toBe('summer-camp-2026');
    expect(slugify('  Camp Cañada!  ')).toBe('camp-canada');
    expect(slugify("Giver's Grove & Tree Sponsors")).toBe('givers-grove-and-tree-sponsors');
    expect(slugify('!!!')).toBe('');
  });
});

describe('slugProblem', () => {
  const ctx = { existing: ['index', 'weddings', 'golf/rates'], reserved: ['sitemap'] };
  it('accepts a free slug, including nested ones', () => {
    expect(slugProblem('spring-gala', ctx)).toBeNull();
    expect(slugProblem('golf/juniors', ctx)).toBeNull();
  });
  it('refuses duplicates', () => {
    expect(slugProblem('weddings', ctx)).toMatch(/already a page/);
    expect(slugProblem('golf/rates', ctx)).toMatch(/already a page/);
  });
  it('refuses paths the site or the editor owns, at any depth', () => {
    for (const s of ['edit', 'api', 'sitemap', 'edit/anything']) expect(slugProblem(s, ctx)).toMatch(/used by the site/);
  });
  it('refuses slugs that would land on an editor screen', () => {
    for (const s of ['login', 'enroll', 'preview', 'global', 'global/menus']) expect(slugProblem(s, ctx)).toMatch(/used by the site/);
  });
  it('refuses anything that is not a clean path', () => {
    for (const s of ['', 'Has Space', '../up', 'a//b', '/lead', 'trail/', 'UPPER']) expect(slugProblem(s, ctx)).toBeTruthy();
  });
});

describe('page documents', () => {
  const source: PageDoc = { title: 'Weddings', description: 'd', layout: { footer: 'cta' }, sections: [{ id: 'aaaaaaa', type: 'hero', settings: { title: 'x' }, blocks: [{ id: 'bbbbbbb', type: 'button', settings: {} }] }] };
  it('new pages are drafts', () => expect(newPage('Hi')).toEqual({ title: 'Hi', status: 'draft', sections: [] }));
  it('a copy is a draft with fresh ids and the same content', () => {
    const c = copyPage({ ...source, status: 'published' }, 'Copy');
    expect(c.status).toBe('draft');
    expect(c.title).toBe('Copy');
    expect(c.layout).toEqual({ footer: 'cta' });
    expect(c.sections[0].id).not.toBe('aaaaaaa');
    expect(c.sections[0].blocks![0].id).not.toBe('bbbbbbb');
    expect(c.sections[0].settings).toEqual({ title: 'x' });
  });
  it('uniqueSlug counts up', () => expect(uniqueSlug('a', ['a', 'a-2'])).toBe('a-3'));
  it('publicPath', () => { expect(publicPath('index')).toBe('/'); expect(publicPath('a/b')).toBe('/a/b/'); });
  it('addRedirect appends one line', () => {
    expect(addRedirect('/x /y 301', 'old', 'new')).toBe('/x /y 301\n/old/ /new/ 301\n');
    expect(addRedirect('', 'old', 'new')).toBe('\n/old/ /new/ 301\n');
  });
});

describe('staticPages', () => {
  const page = (o = {}): PageDoc => ({ title: 't', sections: [], ...o });
  it('maps glob keys to params and leaves drafts out', () => {
    const paths = staticPages({
      '../content/pages/index.json': { default: page() },
      '../content/pages/weddings.json': { default: page() },
      '../content/pages/golf/rates.json': { default: page() },
      '../content/pages/secret.json': { default: page({ status: 'draft' }) },
    });
    expect(paths.map((p) => p.params.page)).toEqual([undefined, 'weddings', 'golf/rates']);
    expect(paths[1].props.page.title).toBe('t');
  });
  it('takes a param name and a base', () => {
    expect(staticPages({ '/src/docs/a.json': page() }, { param: 'path', base: 'docs/' })[0].params).toEqual({ path: 'a' });
  });
});
