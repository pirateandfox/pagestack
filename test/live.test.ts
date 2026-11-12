import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liveEntries } from '../live.mjs';

const store = vi.hoisted(() => ({
  head: 'a' as string | null,
  files: { 'one.md': '---\ntitle: One\ndate: 2026-11-01\n---\nBody one', 'two.md': '---\ntitle: Two\ndate: 2026-11-02\n---\n', 'notes.txt': 'x' } as Record<string, string>,
  calls: { head: 0, readDir: 0, readDirs: 0 },
  dirs: false,
}));
vi.mock('../src/server/context', () => ({
  collections: { articles: { label: 'Articles', dir: 'src/content/articles', fields: {} }, news: { label: 'News', dir: 'src/content/news', fields: {} } },
  storage: () => ({
    ...(store.head === null ? {} : { head: async () => { store.calls.head++; return store.head!; } }),
    readDir: async () => { store.calls.readDir++; return Object.entries(store.files).map(([name, content]) => ({ name, content })); },
    ...(store.dirs ? { readDirs: async (dirs: string[], ref?: string) => {
      store.calls.readDirs++;
      return Object.fromEntries(dirs.map((d) => [d, d.endsWith('news') ? [{ name: `at-${ref}.md`, content: '---\ntitle: N\n---\n' }] : []]));
    } } : {}),
  }),
}));
const { liveCollection } = await import('../src/server/live');

let clock = 1_000_000;
beforeEach(() => { store.calls = { head: 0, readDir: 0, readDirs: 0 }; store.dirs = false; clock += 60_000; });

describe('live collections on the editor server', () => {
  it('reads Markdown entries in the shape getCollection gives', async () => {
    const e = await liveCollection('articles', clock);
    expect(e!.map((x) => x.id).sort()).toEqual(['one', 'two']);
    expect(e!.find((x) => x.id === 'one')).toMatchObject({ collection: 'articles', data: { title: 'One' }, body: 'Body one', filePath: 'src/content/articles/one.md' });
  });

  it('loads every collection at the head commit in one read', async () => {
    store.dirs = true; store.head = 'h-all';
    expect((await liveCollection('news', clock))!.map((x) => x.id)).toEqual(['at-h-all']);
    expect(await liveCollection('articles', clock)).toEqual([]);
    expect(store.calls).toMatchObject({ readDirs: 1, readDir: 0 });
  });

  it('is null for a collection the editor does not know, so the caller uses the build', async () => {
    expect(await liveCollection('nope', clock)).toBeNull();
  });

  it('reads once per branch head, and asks for the head at most once a second', async () => {
    store.head = 'h1';
    await liveCollection('articles', clock);
    await liveCollection('articles', clock + 200);
    await liveCollection('articles', clock + 900);
    expect(store.calls).toMatchObject({ head: 1, readDir: 1 });
    await liveCollection('articles', clock + 1500); // head asked again, unchanged: no re-read
    expect(store.calls).toMatchObject({ head: 2, readDir: 1 });
    store.head = 'h2'; // a save
    await liveCollection('articles', clock + 3000);
    expect(store.calls).toMatchObject({ head: 3, readDir: 2 });
  });

  it('without a head to compare, reads every time (local storage is the working tree)', async () => {
    store.head = null;
    await liveCollection('articles', clock);
    await liveCollection('articles', clock + 1);
    expect(store.calls.readDir).toBe(2);
    store.head = 'a';
  });
});

describe('liveEntries (what host sites import)', () => {
  beforeEach(() => { delete (globalThis as any).__PS_LIVE__; });

  it('is null outside the editor server, so the public build uses getCollection', async () => {
    expect(await liveEntries('articles')).toBeNull();
  });

  it('applies the schema and leaves out entries the build would reject', async () => {
    (globalThis as any).__PS_LIVE__ = async () => [
      { id: 'ok', collection: 'articles', data: { title: 'Fine', n: '3' }, body: '', filePath: 'a' },
      { id: 'bad', collection: 'articles', data: {}, body: '', filePath: 'b' },
    ];
    const schema = { parse: (d: any) => { if (!d.title) throw new Error('title required'); return { ...d, n: Number(d.n) }; } };
    expect(await liveEntries('articles', schema)).toEqual([{ id: 'ok', collection: 'articles', data: { title: 'Fine', n: 3 }, body: '', filePath: 'a' }]);
  });

  it('is null when the editor does not have the collection', async () => {
    (globalThis as any).__PS_LIVE__ = async () => null;
    expect(await liveEntries('nope')).toBeNull();
  });
});
