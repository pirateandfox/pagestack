import { describe, expect, it } from 'vitest';
import { GitHubStorage } from '../src/core/storage-github';

/** Staging is `develop`, live is `main`. `ff` says whether main can fast-forward; `merge` what POST /merges answers. */
function fake({ ahead = 2, ff = true, merge = 201 }: { ahead?: number; ff?: boolean; merge?: number } = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/repos/o/r/', '') + url.search;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
    if (path.startsWith('compare/main...develop')) {
      const commits = Array.from({ length: ahead }, (_, i) => ({ sha: `s${i}`, commit: { message: `Edit page p${i}\n\nEdited by Ana`, author: { name: 'bot', date: `2026-11-1${i}T10:00:00Z` } } }));
      return json({ ahead_by: ahead, commits });
    }
    if (path === 'git/ref/heads/develop') return json({ object: { sha: 'stagehead' } });
    if (path === 'git/refs/heads/main' && method === 'PATCH') return ff ? json({ object: { sha: body.sha } }) : json({ message: 'Update is not a fast forward' }, 422);
    if (path === 'merges' && method === 'POST') return merge === 201 ? json({ sha: 'mergesha', html_url: 'https://github.com/o/r/commit/mergesha' }, 201) : new Response(merge === 204 ? null : '{"message":"Merge conflict"}', { status: merge });
    if (path === 'git/refs/heads/develop' && method === 'PATCH') return json({ object: { sha: body.sha } });
    return json({ message: `unhandled ${method} ${path}` }, 500);
  };
  const storage = new GitHubStorage({ repo: 'o/r', branch: 'develop', live: 'main', token: 't', fetch: fetch as unknown as typeof globalThis.fetch });
  return { calls, storage };
}

describe('Go live (github.live)', () => {
  it('lists what is waiting, newest first, with the editor from the commit message', async () => {
    const { storage } = fake({ ahead: 3 });
    const p = await storage.pending();
    expect(p).toMatchObject({ branch: 'develop', live: 'main', count: 3 });
    expect(p.changes.map((c) => c.message)).toEqual(['Edit page p2', 'Edit page p1', 'Edit page p0']);
    expect(p.changes[0].author).toBe('Ana');
  });

  it('fast-forwards live to the staging head when it can', async () => {
    const { calls, storage } = fake();
    expect(await storage.goLive('Go live')).toEqual({ commit: 'stagehead', url: 'https://github.com/o/r/commit/stagehead', merged: false });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: 'git/refs/heads/main', body: { sha: 'stagehead', force: false } });
    expect(calls.some((c) => c.path === 'merges')).toBe(false);
  });

  it('merges when live has commits of its own, then moves staging to the merge', async () => {
    const { calls, storage } = fake({ ff: false });
    expect(await storage.goLive('Go live: 2 changes')).toMatchObject({ commit: 'mergesha', merged: true });
    expect(calls.find((c) => c.path === 'merges')?.body).toEqual({ base: 'main', head: 'stagehead', commit_message: 'Go live: 2 changes' });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: 'git/refs/heads/develop', body: { sha: 'mergesha', force: false } });
  });

  it('refuses a conflict with a message a person can act on, and never forces', async () => {
    const { calls, storage } = fake({ ff: false, merge: 409 });
    await expect(storage.goLive('x')).rejects.toThrow(/conflict.*merge develop into main/);
    expect(calls.filter((c) => c.method === 'PATCH').every((c) => c.body.force === false)).toBe(true);
  });

  it('reports nothing to do when the merge has nothing to bring', async () => {
    const { storage } = fake({ ff: false, merge: 204 });
    expect(await storage.goLive('x')).toBeNull();
  });

  it('is not available without a live branch', async () => {
    const s = new GitHubStorage({ repo: 'o/r', branch: 'main', token: 't', fetch: (async () => new Response('{}')) as any });
    await expect(s.pending()).rejects.toThrow(/no live branch/);
  });
});
