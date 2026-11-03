import { describe, expect, it } from 'vitest';
import { GitHubStorage } from '../src/core/storage-github';
import { toBase64 } from '../src/core/storage';

interface Call { method: string; path: string; body?: any; headers: Record<string, string> }

/** A tiny fake of the parts of the GitHub REST API the adapter touches. */
function fakeGitHub(files: Record<string, string> = {}, opts: { failWith?: number } = {}) {
  const calls: Call[] = [];
  let blobs = 0;
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: init.headers as Record<string, string> });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (opts.failWith) return new Response('{"message":"Resource not accessible by integration"}', { status: opts.failWith });
    const m = path.match(/^\/repos\/o\/r\/(.*)$/);
    if (!m) return json({ message: 'nope' }, 404);
    const rest = m[1];
    if (rest.startsWith('contents/')) {
      const p = decodeURIComponent(rest.slice('contents/'.length).split('?')[0]);
      if (p in files) return p === 'big.json' ? json({ type: 'file', sha: 'bigsha', encoding: 'none', content: '' }) : json({ type: 'file', encoding: 'base64', content: toBase64(new TextEncoder().encode(files[p])).replace(/(.{60})/g, '$1\n') });
      const children = Object.keys(files).filter((f) => f.startsWith(p + '/')).map((f) => f.slice(p.length + 1));
      if (!children.length) return json({ message: 'Not Found' }, 404);
      const seen = new Set<string>();
      return json(children.map((c) => { const [head, ...tail] = c.split('/'); if (seen.has(head)) return null; seen.add(head); return tail.length ? { name: head, type: 'dir' } : { name: head, type: 'file', size: files[`${p}/${head}`].length }; }).filter(Boolean));
    }
    if (rest === 'git/blobs/bigsha') return json({ content: toBase64(new TextEncoder().encode(files['big.json'])), encoding: 'base64' });
    if (rest === 'git/ref/heads/main') return json({ object: { sha: 'base000' } });
    if (rest === 'git/commits/base000') return json({ tree: { sha: 'tree000' } });
    if (rest === 'git/blobs' && method === 'POST') return json({ sha: `blob${++blobs}` });
    if (rest === 'git/trees' && method === 'POST') return json({ sha: 'tree111' });
    if (rest === 'git/commits' && method === 'POST') return json({ sha: 'c0ffee1234567', html_url: 'https://github.com/o/r/commit/c0ffee1234567' });
    if (rest === 'git/refs' && method === 'POST') return json({ ref: body.ref }, 201);
    if (rest === 'git/refs/heads/main' && method === 'PATCH') return json({ object: { sha: body.sha } });
    if (rest === 'pulls' && method === 'POST') return json({ html_url: 'https://github.com/o/r/pull/7', number: 7 }, 201);
    return json({ message: `unhandled ${method} ${path}` }, 500);
  };
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}
const make = (gh: ReturnType<typeof fakeGitHub>, extra: Partial<ConstructorParameters<typeof GitHubStorage>[0]> = {}) => new GitHubStorage({ repo: 'o/r', branch: 'main', token: 'tok_test', fetch: gh.fetch, ...extra });

describe('GitHubStorage', () => {
  it('validates its options', () => {
    expect(() => new GitHubStorage({ repo: 'bad repo', token: 'x' })).toThrow(/owner\/name/);
    expect(() => new GitHubStorage({ repo: 'o/r', token: '' })).toThrow(/token/);
  });
  it('reads files through the contents API with the token, decoding base64', async () => {
    const gh = fakeGitHub({ 'src/content/pages/index.json': '{"title":"Home"}' });
    const s = make(gh);
    expect(await s.readFile('src/content/pages/index.json')).toBe('{"title":"Home"}');
    expect(await s.readFile('src/content/pages/missing.json')).toBeNull();
    expect(gh.calls[0]).toMatchObject({ method: 'GET', path: '/repos/o/r/contents/src/content/pages/index.json?ref=main' });
    expect(gh.calls[0].headers.authorization).toBe('Bearer tok_test');
    expect(gh.calls[0].headers['x-github-api-version']).toBe('2022-11-28');
  });
  it('falls back to the blob endpoint for files over 1 MB', async () => {
    const gh = fakeGitHub({ 'big.json': '{"big":true}' });
    expect(await make(gh).readFile('big.json')).toBe('{"big":true}');
    expect(gh.calls.map((c) => c.path)).toEqual(['/repos/o/r/contents/big.json?ref=main', '/repos/o/r/git/blobs/bigsha']);
  });
  it('lists a directory and merges staged uploads', async () => {
    const gh = fakeGitHub({ 'public/images/a.jpg': 'xx', 'public/images/sub/b.jpg': 'y' });
    const s = make(gh);
    await s.putAsset('public/images/new.png', new Uint8Array([1, 2, 3]));
    expect(await s.listDir('public/images')).toEqual([{ name: 'a.jpg', type: 'file', size: 2 }, { name: 'sub', type: 'dir', size: undefined }, { name: 'new.png', type: 'file', size: 3 }]);
    expect(await s.listDir('nope')).toEqual([]);
    expect(s.pendingAsset('public/images/new.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(s.pendingAsset('public/images/a.jpg')).toBeUndefined();
  });
  it('commits text changes plus staged assets as one commit on the branch', async () => {
    const gh = fakeGitHub();
    const s = make(gh);
    await s.putAsset('public/images/uploads/pic.png', new Uint8Array([137, 80]));
    const res = await s.commit({ message: 'Edit home page via site editor', files: [{ path: 'src/content/pages/index.json', content: '{"title":"New"}\n' }] });
    expect(gh.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /repos/o/r/git/ref/heads/main',
      'GET /repos/o/r/git/commits/base000',
      'POST /repos/o/r/git/blobs',
      'POST /repos/o/r/git/blobs',
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/main',
    ]);
    expect(gh.calls[2].body).toEqual({ content: '{"title":"New"}\n', encoding: 'utf-8' });
    expect(gh.calls[3].body).toEqual({ content: toBase64(new Uint8Array([137, 80])), encoding: 'base64' });
    expect(gh.calls[4].body).toEqual({ base_tree: 'tree000', tree: [
      { path: 'src/content/pages/index.json', mode: '100644', type: 'blob', sha: 'blob1' },
      { path: 'public/images/uploads/pic.png', mode: '100644', type: 'blob', sha: 'blob2' },
    ] });
    expect(gh.calls[5].body).toMatchObject({ message: 'Edit home page via site editor', tree: 'tree111', parents: ['base000'] });
    expect(gh.calls[6].body).toEqual({ sha: 'c0ffee1234567', force: false });
    expect(res).toEqual({ kind: 'github', files: ['src/content/pages/index.json', 'public/images/uploads/pic.png'], commit: 'c0ffee1234567', url: 'https://github.com/o/r/commit/c0ffee1234567', branch: 'main', pullRequest: undefined });
    expect(s.pendingAsset('public/images/uploads/pic.png')).toBeUndefined(); // staged assets cleared
  });
  it('opens a pull request from a fresh branch when asked', async () => {
    const gh = fakeGitHub();
    const s = make(gh, { pullRequest: true, author: { name: 'Site editor', email: 'editor@example.com' } });
    const res = await s.commit({ message: 'Edit contact', files: [{ path: 'src/content/pages/contact.json', content: '{}' }] });
    const tail = gh.calls.slice(-2);
    expect(tail[0]).toMatchObject({ method: 'POST', path: '/repos/o/r/git/refs' });
    expect(tail[0].body.ref).toMatch(/^refs\/heads\/site-editor\/\d{14}-c0ffee1$/);
    expect(tail[1]).toMatchObject({ method: 'POST', path: '/repos/o/r/pulls', body: { title: 'Edit contact', base: 'main' } });
    expect(tail[1].body.head).toBe(tail[0].body.ref.replace('refs/heads/', ''));
    expect(gh.calls.find((c) => c.path === '/repos/o/r/git/commits' && c.method === 'POST')!.body.author).toEqual({ name: 'Site editor', email: 'editor@example.com' });
    expect(gh.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(res.pullRequest).toBe('https://github.com/o/r/pull/7');
    expect(res.branch).toMatch(/^site-editor\//);
  });
  it('refuses an empty commit and surfaces API errors', async () => {
    await expect(make(fakeGitHub()).commit({ message: 'x', files: [] })).rejects.toThrow(/nothing to commit/);
    const denied = make(fakeGitHub({}, { failWith: 403 }));
    await expect(denied.commit({ message: 'x', files: [{ path: 'a', content: 'b' }] })).rejects.toThrow(/GitHub GET \/repos\/o\/r\/git\/ref\/heads\/main -> 403/);
    await expect(denied.readFile('a')).rejects.toThrow(/403/);
  });
});
