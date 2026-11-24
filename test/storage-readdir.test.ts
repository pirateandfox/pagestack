import { describe, expect, it } from 'vitest';
import { GitHubStorage } from '../src/core/storage-github';
import { fakeGitHub } from './fake-github';

/** The REST requests, with no GraphQL: what a token or a stand-in API without it looks like. */
function restOnly(graphqlStatus: number) {
  const urls: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace('/repos/o/r/', '');
    urls.push(path);
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
    if (path === '/graphql') return json({ message: 'no' }, graphqlStatus);
    if (path === 'git/trees/develop') return json({ truncated: false, tree: [{ path: 'src/content/posts/a.md', type: 'blob', sha: 'a1' }] });
    if (path === 'commits/develop') return json({ sha: 'c1', commit: { committer: { date: '2026-11-12T10:00:00Z' } } });
    if (path === 'git/ref/heads/develop') return json({ object: { sha: 'c1' } });
    return json({ message: `unhandled ${path}` }, 500);
  };
  return { urls, storage: new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: fetch as unknown as typeof globalThis.fetch }) };
}

describe('GitHub branch head', () => {
  it('reports the branch head and when it last changed', async () => {
    const { storage } = restOnly(200);
    expect(await storage.head!()).toBe('c1');
    expect(await storage.lastChange!()).toBe('2026-11-12T10:00:00Z');
  });
});

describe('GitHub readDirs', () => {
  it('reads several folders at a commit in one GraphQL request', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ data: { repository: {
        d0: { entries: [{ name: 'a.md', type: 'blob', object: { oid: '1', text: 'one', isBinary: false, isTruncated: false } }, { name: 'sub', type: 'tree', object: {} }] },
        d1: { entries: [{ name: 'x.png', type: 'blob', object: { oid: '2', text: null, isBinary: true, isTruncated: false } }, { name: 'b.md', type: 'blob', object: { oid: '3', text: 'two', isBinary: false, isTruncated: false } }] },
      } } }));
    };
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await storage.readDirs!(['src/content/posts', 'src/content/news'], 'abc123')).toEqual({
      'src/content/posts': [{ name: 'a.md', content: 'one' }],
      'src/content/news': [{ name: 'b.md', content: 'two' }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/graphql');
    expect(calls[0].body.variables).toMatchObject({ owner: 'o', name: 'r', e0: 'abc123:src/content/posts', e1: 'abc123:src/content/news' });
  });

  it('reads one folder the same way', async () => {
    const gh = fakeGitHub({ 'src/content/posts/a.md': 'Ä one', 'src/content/posts/b.md': '\uFEFFtwo', 'src/content/posts/drafts/c.md': 'no', 'src/content/posts/pic.png': null });
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: gh.fetch });
    expect(await storage.readDir('src/content/posts')).toEqual([{ name: 'a.md', content: 'Ä one' }, { name: 'b.md', content: 'two' }]);
    expect(gh.urls()).toEqual(['/graphql']);
    expect(await storage.readDirs(['src/nope'])).toEqual({ 'src/nope': [] });
  });

  it('brings as many levels of subfolders as asked for', async () => {
    const gh = fakeGitHub({ 'p/a.json': 'a', 'p/x/b.json': 'b', 'p/x/y/c.json': 'c' });
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: gh.fetch });
    expect((await storage.readDirs(['p'], undefined, 1)).p).toEqual([{ name: 'a.json', content: 'a' }, { name: 'x/b.json', content: 'b' }]);
    expect(gh.urls()).toEqual(['/graphql']);
  });

  it('fetches a text GraphQL cut short, once', async () => {
    const gh = fakeGitHub({ 'p/a.md': 'a whole long text' }, { truncate: ['p/a.md'] });
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: gh.fetch });
    expect(await storage.readDirs(['p'])).toEqual({ p: [{ name: 'a.md', content: 'a whole long text' }] });
    await storage.readDirs(['p']);
    expect(gh.urls().filter((u) => u.includes('/git/blobs/'))).toHaveLength(1);
  });
});

describe('GitHub readDirs when one request is too much', () => {
  const files: Record<string, string | null> = { 'other/z.md': 'z', 'posts/deep/d.md': 'd', 'posts/pic.png': null };
  for (let i = 0; i < 120; i++) files[`posts/${String(i).padStart(3, '0')}.md`] = `batched ${i}`;

  it('reads the files in batches, and only new ones the next time', async () => {
    const gh = fakeGitHub(files, { folderQueries: 502 });
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: gh.fetch });
    const { posts } = await storage.readDirs(['posts']);
    expect(posts).toHaveLength(120);
    expect(posts[7]).toEqual({ name: '007.md', content: 'batched 7' });
    expect(gh.urls()).toEqual(['/graphql', '/repos/o/r/git/trees/develop', '/graphql', '/graphql', '/graphql']);
    expect(await storage.readDirs(['posts', 'nope'], undefined, 1)).toMatchObject({ nope: [] });
    expect(gh.urls()).toHaveLength(8); // the refused query, the listing, one batch (d.md and the image)
  });

  it('says so when GitHub refuses GraphQL, and never reads file by file', async () => {
    for (const status of [401, 403, 404]) {
      const { storage, urls } = restOnly(status);
      await expect(storage.readDirs(['src/content/posts'])).rejects.toThrow(`GraphQL -> ${status}`);
      expect(urls).toEqual(['/graphql']);
    }
    const down = restOnly(503);
    await expect(down.storage.readDirs(['src/content/posts'])).rejects.toThrow('GraphQL -> 503');
    expect(down.urls).toEqual(['/graphql', 'git/trees/develop', '/graphql']);
  });

  it('does not retry past a rate limit', async () => {
    const gh = fakeGitHub(files, { folderQueries: 'RATE_LIMITED' });
    const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: gh.fetch });
    await expect(storage.readDirs(['posts'])).rejects.toThrow('RATE_LIMITED');
    expect(gh.urls()).toEqual(['/graphql']);
  });
});
