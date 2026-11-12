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

function toEntries(name: string, dir: string, files: { name: string; content: string }[]): LiveEntry[] {
  return files.filter((f) => f.name.endsWith('.md')).map((f) => {
    const { data, body } = parseMarkdown(f.content);
    return { id: f.name.slice(0, -3), collection: name, data, body, filePath: `${dir}/${f.name}` };
  });
}

async function read(name: string, dir: string): Promise<LiveEntry[]> {
  const s = storage();
  const files = s.readDir
    ? await s.readDir(dir)
    : await Promise.all((await s.listDir(dir)).filter((e) => e.type === 'file').map(async (e) => ({ name: e.name, content: (await s.readFile(`${dir}/${e.name}`)) ?? '' })));
  return toEntries(name, dir, files);
}

/**
 * Every collection at one commit, in one request where the store allows it: a page usually lists
 * more than one (a footer, related items), and on a fresh server each separate read is a round trip.
 */
function readAll(sha: string): Map<string, Promise<LiveEntry[]>> {
  const s = storage();
  const names = Object.keys(collections);
  const byName = new Map<string, Promise<LiveEntry[]>>();
  if (!s.readDirs) return byName; // each collection read when first asked for
  const all = s.readDirs(names.map((n) => collections[n].dir), sha);
  for (const n of names) byName.set(n, all.then((r) => toEntries(n, collections[n].dir, r[collections[n].dir] ?? [])));
  for (const p of byName.values()) p.catch(() => {}); // collections nobody asked for yet: no unhandled rejection
  return byName;
}

export async function liveCollection(name: string, now = Date.now()): Promise<LiveEntry[] | null> {
  const c = Object.hasOwn(collections, name) ? collections[name] : null;
  if (!c) return null;
  const sha = await currentHead(now);
  if (!sha) return read(name, c.dir);
  if (cached?.sha !== sha) cached = { sha, byName: readAll(sha) };
  let entries = cached.byName.get(name);
  if (!entries) {
    entries = read(name, c.dir);
    cached.byName.set(name, entries);
  }
  const mine = entries;
  // A failed read is not kept: the next request tries again.
  mine.catch(() => { if (cached?.byName.get(name) === mine) cached.byName.delete(name); });
  return entries;
}
