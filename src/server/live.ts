// Collection entries straight from storage, for host list pages rendered on the editor's server
// (see live.mjs). The collection name is the editor's collection id.
//
// With a store that knows its head commit (GitHub), entries are kept until the branch moves, and
// the head is asked at most once a second, so a page that lists four collections costs one request.
import { collections, storage } from './context';
import { parseMarkdown } from '../core/frontmatter';

export interface LiveEntry { id: string; collection: string; data: Record<string, any>; body: string; filePath: string }

const HEAD_TTL = 1000;
let headCheck: { at: number; sha: Promise<string> } | null = null;
let cached: { sha: string; byName: Map<string, Promise<LiveEntry[]>> } | null = null;

async function currentHead(now: number): Promise<string | null> {
  const s = storage();
  if (!s.head) return null;
  if (!headCheck || now - headCheck.at > HEAD_TTL) headCheck = { at: now, sha: s.head() };
  try { return await headCheck.sha; } catch { headCheck = null; return null; }
}

async function read(name: string, dir: string): Promise<LiveEntry[]> {
  const s = storage();
  const files = s.readDir
    ? await s.readDir(dir)
    : await Promise.all((await s.listDir(dir)).filter((e) => e.type === 'file').map(async (e) => ({ name: e.name, content: (await s.readFile(`${dir}/${e.name}`)) ?? '' })));
  return files.filter((f) => f.name.endsWith('.md')).map((f) => {
    const { data, body } = parseMarkdown(f.content);
    return { id: f.name.slice(0, -3), collection: name, data, body, filePath: `${dir}/${f.name}` };
  });
}

export async function liveCollection(name: string, now = Date.now()): Promise<LiveEntry[] | null> {
  const c = Object.hasOwn(collections, name) ? collections[name] : null;
  if (!c) return null;
  const sha = await currentHead(now);
  if (!sha) return read(name, c.dir);
  if (cached?.sha !== sha) cached = { sha, byName: new Map() };
  let entries = cached.byName.get(name);
  if (!entries) {
    entries = read(name, c.dir);
    cached.byName.set(name, entries);
    entries.catch(() => { if (cached?.byName.get(name) === entries) cached.byName.delete(name); });
  }
  return entries;
}
