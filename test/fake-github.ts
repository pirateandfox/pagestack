// A repository behind the GitHub API, counting requests. Like a Worker on Cloudflare's free plan, it
// can refuse any request past a limit. Files map a path to its text, or null for a binary.
import { toBase64 } from '../src/core/storage';

interface Options {
  /** Requests allowed before fetch throws. Reset with `newPage()`. */
  limit?: number;
  /** Files whose text GraphQL cuts short. */
  truncate?: string[];
  /** How folder queries fail: an HTTP status, or a GraphQL error type. Blob queries still work. */
  folderQueries?: number | string;
  /** Files on the uploads branch, waiting for a save. */
  uploads?: string[];
  /** Recursive listings of these folders come back cut short. */
  cutListings?: string[];
}

let repos = 0;

export function fakeGitHub(files: Record<string, string | null>, o: Options = {}) {
  let calls: string[] = [];
  const repo = ++repos; // hashes differ between repos: the adapter caches by hash across instances
  const paths = Object.keys(files).sort();
  const oid = (p: string) => `${repo}x${paths.indexOf(p)}`;
  const blob = (p: string) => {
    const cut = o.truncate?.includes(p) ?? false;
    return { oid: oid(p), text: cut ? files[p]!.slice(0, 3) : files[p], isBinary: files[p] === null, isTruncated: cut };
  };
  /** A folder as a query `levels` deep sees it. */
  const tree = (dir: string, levels: number): { entries: unknown[] } | null => {
    const inside = paths.filter((p) => p.startsWith(`${dir}/`));
    if (!inside.length) return null;
    const names = [...new Set(inside.map((p) => p.slice(dir.length + 1).split('/')[0]))];
    return { entries: names.map((name) => {
      const p = `${dir}/${name}`;
      return p in files ? { name, type: 'blob', object: blob(p) } : { name, type: 'tree', object: levels > 1 ? tree(p, levels - 1)! : {} };
    }) };
  };
  /** Tree hashes name a folder and the branch it is on. */
  const treeSha = (dir: string, waiting: boolean) => (waiting ? o.uploads ?? [] : paths).some((p) => p.startsWith(`${dir}/`)) ? `${repo}t${waiting ? 'u' : 'm'}${dir.replaceAll('/', '~')}` : null;
  const listing = (sha: string, recursive: boolean) => {
    const [, kind, flat] = sha.match(/^\d+t([um])(.+)$/)!;
    const dir = flat.replaceAll('~', '/');
    const inside = (kind === 'u' ? o.uploads ?? [] : paths).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
    if (recursive && o.cutListings?.includes(dir)) return { truncated: true, tree: [] };
    const names = recursive ? inside : [...new Set(inside.map((p) => p.split('/')[0]))];
    return { truncated: false, tree: names.map((n) => (inside.includes(n) ? { path: n, type: 'blob', sha: 'b', size: 3 } : { path: n, type: 'tree', sha: treeSha(`${dir}/${n}`, kind === 'u') })) };
  };
  let saved: any = null;
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (calls.length >= (o.limit ?? Infinity)) throw new Error('Too many subrequests.');
    calls.push(url.pathname);
    if (url.pathname === '/graphql') {
      const { query, variables } = JSON.parse(String(init!.body));
      const repository: Record<string, unknown> = {};
      const folders = [...query.matchAll(/(d\d+): object\(expression: \$(e\d+)\)/g)];
      if (folders.length && o.folderQueries) {
        return typeof o.folderQueries === 'number' ? json({ message: 'timeout' }, o.folderQueries) : json({ data: null, errors: [{ type: o.folderQueries }] });
      }
      if ('ref' in variables) repository.at = { oid: 'base' };
      for (const [, field, v] of query.matchAll(/(f\d+): object\(expression: \$(e\d+)\)/g)) {
        const p = variables[v].replace(/^[^:]+:/, '');
        repository[field] = p in files ? blob(p) : null;
      }
      for (const [, field, v] of query.matchAll(/(t\d+): object\(expression: \$(e\d+)\)/g)) {
        const [ref, p] = variables[v].split(':');
        const oid = treeSha(p, ref === 'pagestack-uploads');
        repository[field] = oid && { oid };
      }
      const levels = folders.length ? query.match(/on Tree/g).length / folders.length : 0;
      for (const [, field, v] of folders) repository[field] = tree(variables[v].replace(/^[^:]+:/, ''), levels);
      for (const [, field, v] of query.matchAll(/(b\d+): object\(oid: \$(e\d+)\)/g)) repository[field] = blob(paths.find((p) => oid(p) === variables[v])!);
      return json({ data: { repository } });
    }
    const path = url.pathname.replace('/repos/o/r/', '');
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      if (path === 'git/trees') saved = JSON.parse(String(init.body)).tree;
      return json({ sha: 'new0000000', tree: { sha: 'newtree' } });
    }
    if (path === 'git/ref/heads/develop') return json({ object: { sha: 'base' } });
    if (path === 'git/commits/base') return json({ tree: { sha: 'basetree' } });
    const t = path.match(/^git\/trees\/(\d+t[um].+)$/);
    if (t) return json(listing(decodeURIComponent(t[1]), url.searchParams.has('recursive')));
    if (path.startsWith('git/trees/')) return json({ truncated: false, tree: paths.map((p) => ({ path: p, type: 'blob', sha: oid(p) })) });
    const b = path.match(/^git\/blobs\/(.+)$/);
    const content = (p: string) => ({ type: 'file', encoding: 'base64', content: toBase64(new TextEncoder().encode(files[p] ?? '')) });
    if (b) return json(content(paths.find((p) => oid(p) === b[1])!));
    const file = path.match(/^contents\/(.+)$/)?.[1];
    if (file && file in files) return json(content(file));
    if (file && url.searchParams.get('ref') !== 'pagestack-uploads') {
      const folder = tree(file, 1);
      if (folder) return json(folder.entries.map((e: any) => ({ name: e.name, type: e.type === 'blob' ? 'file' : 'dir', sha: e.object.oid })));
    }
    return json({ message: 'Not Found' }, 404);
  }) as unknown as typeof globalThis.fetch;

  return { fetch, urls: () => calls, /** What the last commit changed. */ saved: () => saved, newPage: () => { calls = []; } };
}
