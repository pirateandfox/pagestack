import { describe, expect, it } from 'vitest';
import { GitHubStorage } from '../src/core/storage-github';
import { toBase64 } from '../src/core/storage';

/** A folder listing plus blobs by sha, counting blob downloads. */
function fake(files: Record<string, { sha: string; text: string }>) {
  const blobGets: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/repos/o/r/', '');
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
    if (path === 'contents/src/content/posts') {
      return json([...Object.entries(files).map(([name, f]) => ({ name, type: 'file', sha: f.sha, size: f.text.length })), { name: 'drafts', type: 'dir', sha: 'd' }]);
    }
    const b = path.match(/^git\/blobs\/(\w+)$/);
    if (b) {
      blobGets.push(b[1]);
      const f = Object.values(files).find((x) => x.sha === b[1]);
      return f ? json({ content: toBase64(new TextEncoder().encode(f.text)), encoding: 'base64' }) : json({ message: 'Not Found' }, 404);
    }
    if (path === 'commits/develop') return json({ sha: 'c1', commit: { committer: { date: '2026-11-12T10:00:00Z' } } });
    if (path === 'git/ref/heads/develop') return json({ object: { sha: 'c1' } });
    return json({ message: `unhandled ${path}` }, 500);
  };
  return { blobGets, storage: new GitHubStorage({ repo: 'o/r', branch: 'develop', token: 't', fetch: fetch as unknown as typeof globalThis.fetch }) };
}

describe('GitHub readDir', () => {
  it('returns every file in the folder with its contents, and skips subfolders', async () => {
    const { storage } = fake({ 'a.md': { sha: 'sa1', text: 'Ä one' }, 'b.md': { sha: 'sb1', text: 'two' } });
    expect(await storage.readDir!('src/content/posts')).toEqual([{ name: 'a.md', content: 'Ä one' }, { name: 'b.md', content: 'two' }]);
  });

  it('downloads a file again only when its contents changed', async () => {
    const files = { 'a.md': { sha: 'ca1', text: 'one' }, 'b.md': { sha: 'cb1', text: 'two' } };
    const { storage, blobGets } = fake(files);
    await storage.readDir!('src/content/posts');
    await storage.readDir!('src/content/posts');
    expect(blobGets).toEqual(['ca1', 'cb1']);
    files['b.md'] = { sha: 'cb2', text: 'two, edited' };
    const after = await storage.readDir!('src/content/posts');
    expect(blobGets).toEqual(['ca1', 'cb1', 'cb2']);
    expect(after.find((f) => f.name === 'b.md')?.content).toBe('two, edited');
  });

  it('reports the branch head and when it last changed', async () => {
    const { storage } = fake({});
    expect(await storage.head!()).toBe('c1');
    expect(await storage.lastChange!()).toBe('2026-11-12T10:00:00Z');
  });
});
