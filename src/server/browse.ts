// Browse mode: for a site address, what to show in the frame and which editor screen edits it.
//
//   page     a page the editor manages, shown through its preview (latest saved version)
//   item     a collection item, shown through its preview when the site has one
//   live     a host page in `liveRoutes`, rendered on request from what has been saved
//   snapshot anything else: the copy built into this editor deployment, which can be older
import { collections, opts, readPage, slugRe, storage } from './context';

export interface Resolved {
  path: string;
  kind: 'page' | 'item' | 'live' | 'snapshot';
  /** What the browse frame loads. */
  frame: string;
  /** The editor screen for this page, or null when it isn't editable here. */
  edit: string | null;
  /** Item or page name, when known. */
  label?: string;
}

const SLUG = '__ps_slug__';
const trim = (p: string) => p.replace(/\/+$/, '') || '/';

/** "/articles/x/?a#b" -> "/articles/x/"; only same-site paths, never the editor's own. */
export function normalizePath(input: string | null): string {
  let p = (input ?? '/').trim();
  try { p = new URL(p, 'http://x').pathname; } catch { p = '/'; }
  if (!p.startsWith('/') || p.startsWith('//')) p = '/';
  return p;
}

export const isEditorPath = (p: string) => p === '/edit' || p.startsWith('/edit/') || p.startsWith('/api/');

export function isLiveRoute(pathname: string): boolean {
  const p = trim(pathname.replace(/\/index\.html$/, '/'));
  return (opts.liveRoutes ?? []).some((r) => trim(r) === p);
}

/** The collection item a site path belongs to, from each collection's `url` function. */
function itemFor(path: string): { id: string; slug: string } | null {
  for (const [id, c] of Object.entries(collections)) {
    if (!c.url) continue;
    const pattern = c.url(SLUG);
    const at = pattern.indexOf(SLUG);
    if (at < 0) continue;
    const before = pattern.slice(0, at), after = trim(pattern.slice(at + SLUG.length)) === '/' ? '' : trim(pattern.slice(at + SLUG.length));
    const p = trim(path);
    if (!p.startsWith(before)) continue;
    const rest = p.slice(before.length);
    if (after && !rest.endsWith(after)) continue;
    const slug = after ? rest.slice(0, -after.length) : rest;
    if (/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) return { id, slug };
  }
  return null;
}

export async function resolve(rawPath: string | null): Promise<Resolved> {
  const path = normalizePath(rawPath);
  const item = itemFor(path);
  if (item) {
    const c = collections[item.id];
    const raw = await storage().readFile(`${c.dir}/${item.slug}.md`);
    if (raw !== null) {
      const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(raw)?.[1];
      const preview = Object.hasOwn(opts.previews ?? {}, item.id);
      return {
        path, kind: preview ? 'item' : isLiveRoute(path) ? 'live' : 'snapshot',
        frame: preview ? `/edit/preview-item/${item.id}/${item.slug}?view=1` : path,
        edit: `/edit/collection/${item.id}/${item.slug}`, label: title,
      };
    }
  }
  if (opts.pages !== false && opts.renderer) {
    const slug = trim(path) === '/' ? 'index' : trim(path).slice(1);
    if (slugRe.test(slug) && !slug.includes('..')) {
      const r = await readPage(slug).catch(() => null);
      if (r) return { path, kind: 'page', frame: `/edit/preview/${slug}?view=1`, edit: `/edit/${slug}`, label: r.page.title };
    }
  }
  return { path, kind: isLiveRoute(path) ? 'live' : 'snapshot', frame: path, edit: null };
}
