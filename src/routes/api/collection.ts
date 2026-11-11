// A folder of Markdown files the host declares in `collections`.
// GET    /api/editor/collection/<id>         -> { items }
// POST   /api/editor/collection/<id>         { title, slug } -> creates one (a draft, if the collection has drafts)
// GET    /api/editor/collection/<id>/<slug>  -> { data, body, hash }
//        ?revisions=1 -> { revisions }   ?rev=<sha> -> { data, body } as of that commit
// PUT    /api/editor/collection/<id>/<slug>  { data, body, base, slug? } -> one commit; a new `slug`
//        also moves the file and adds a redirect (when the collection has `url` and the site a redirects file)
// DELETE /api/editor/collection/<id>/<slug>
import type { APIRoute } from 'astro';
import { bad, collections, commitMessage, json, listItems, listPages, opts, reservedSlugs, storage } from '../../server/context';
import { isSha, sha256, type FileChange } from '../../core/storage';
import { parseMarkdown, writeMarkdown } from '../../core/frontmatter';
import { addRedirectLine, slugProblem } from '../../core/pages';
import { plainText, sanitizeFields, sanitizeMarkdown } from '../../core/sanitize';
import type { CollectionDoc } from '../../runtime';
export const prerender = false;

const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
const find = (id?: string) => (id && Object.hasOwn(collections, id) ? collections[id] : null);
const file = (c: CollectionDoc, slug: string) => `${c.dir}/${slug}.md`;
const name = (c: CollectionDoc) => c.singular ?? 'item';

/** Frontmatter fields are cleaned by their schema; anything else in `data` is ignored. */
function cleanData(c: CollectionDoc, data: Record<string, unknown>) {
  const known = Object.fromEntries(Object.keys(c.fields).filter((k) => k in data).map((k) => [k, data[k]]));
  const out = sanitizeFields(known, c.fields) as Record<string, any>;
  if (typeof out.title === 'string') out.title = plainText(out.title);
  return out;
}

export const GET: APIRoute = async ({ params, url }) => {
  const c = find(params.id);
  if (!c) return bad('no such collection', 404);
  if (!params.slug) return json({ items: await listItems(c) });
  if (!SLUG.test(params.slug)) return bad('not found', 404);
  if (url.searchParams.has('revisions')) return json({ revisions: await storage().history(file(c, params.slug)) });
  const rev = url.searchParams.get('rev');
  if (rev) {
    if (!isSha(rev)) return bad('bad revision');
    const old = await storage().readAt(file(c, params.slug), rev);
    return old === null ? bad('no such revision', 404) : json(parseMarkdown(old));
  }
  const raw = await storage().readFile(file(c, params.slug));
  if (raw === null) return bad('not found', 404);
  return json({ ...parseMarkdown(raw), hash: await sha256(raw) });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const c = find(params.id);
  if (!c || params.slug) return bad('no such collection', 404);
  if (c.create === false) return bad('Items here cannot be added from the editor.', 405);
  const body = await request.json().catch(() => null);
  const title = plainText(String(body?.title ?? '')).trim();
  const slug = String(body?.slug ?? '').trim();
  if (!title) return bad('Give it a title.');
  const existing = [...(await listItems(c)).map((i) => i.slug), ...(await listPages()).map((p) => p.slug)];
  const problem = SLUG.test(slug) ? slugProblem(slug, { existing, reserved: reservedSlugs() }) : 'Use letters, numbers and dashes in the URL.';
  if (problem) return bad(problem, 409);
  const data: Record<string, unknown> = { title };
  for (const [k, f] of Object.entries(c.fields)) if (f.default !== undefined && k !== 'title') data[k] = f.default;
  // Only the first date is "today": others (modified, reviewed on) mean something else happened.
  const dated = Object.entries(c.fields).find(([, f]) => f.type === 'date');
  if (dated && data[dated[0]] === undefined) data[dated[0]] = new Date().toISOString().slice(0, dated[1].time === false ? 10 : 19);
  if (c.fields.draft?.type === 'boolean') data.draft = true;
  try {
    const result = await storage().commit({ message: commitMessage(`Add ${name(c)} ${slug}`, locals), files: [{ path: file(c, slug), content: writeMarkdown(null, data, '\n') }] });
    return json({ ok: true, slug, result }, 201);
  } catch (e: any) { return bad(`Could not create it: ${e.message}`, 500); }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const c = find(params.id);
  const slug = params.slug;
  if (!c || !slug || !SLUG.test(slug)) return bad('not found', 404);
  const body = await request.json().catch(() => null);
  if (!body?.data || typeof body.data !== 'object' || typeof body.body !== 'string') return bad('invalid document');
  const raw = await storage().readFile(file(c, slug));
  if (raw === null) return bad('not found', 404);
  if (body.base && body.base !== await sha256(raw)) return json({ error: 'This changed since you opened it. Reload to get the latest version.' }, 409);
  const data = cleanData(c, body.data);
  if ('title' in c.fields && !String(data.title ?? '').trim()) return bad('Give it a title.');
  const content = writeMarkdown(raw, data, sanitizeMarkdown(body.body));
  const next = typeof body.slug === 'string' ? body.slug.trim() : slug;
  const moving = next !== slug;
  if (!moving && content === raw) return json({ ok: true, unchanged: true, hash: await sha256(raw) });
  const files: FileChange[] = [{ path: file(c, next), content }];
  let deletes: string[] | undefined;
  if (moving) {
    const existing = [...(await listItems(c)).map((i) => i.slug), ...(await listPages()).map((p) => p.slug)].filter((s) => s !== slug);
    const problem = SLUG.test(next) ? slugProblem(next, { existing, reserved: reservedSlugs() }) : 'Use letters, numbers and dashes in the URL.';
    if (problem) return bad(problem, 409);
    deletes = [file(c, slug)];
    const redirects = c.url ? await storage().readFile(opts.redirectsFile) : null;
    if (redirects !== null && c.url) files.push({ path: opts.redirectsFile, content: addRedirectLine(redirects, c.url(slug), c.url(next)) });
  }
  const subject = moving ? `Move ${name(c)} ${slug} to ${next} via site editor` : `Edit ${name(c)} ${slug} via site editor`;
  try {
    const result = await storage().commit({ message: commitMessage(subject, locals), files, deletes });
    return json({ ok: true, result, hash: await sha256(content), slug: next, redirected: !!(moving && files.length > 1) });
  } catch (e: any) { return bad(`Save failed: ${e.message}`, 500); }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const c = find(params.id);
  const slug = params.slug;
  if (!c || !slug || !SLUG.test(slug)) return bad('not found', 404);
  try {
    const result = await storage().commit({ message: commitMessage(`Delete ${name(c)} ${slug}`, locals), files: [], deletes: [file(c, slug)] });
    return json({ ok: true, result });
  } catch (e: any) { return bad(`Delete failed: ${e.message}`, 500); }
};
