// A folder of Markdown files the host declares in `collections`.
// GET    /api/editor/collection/<id>         -> { items }
// POST   /api/editor/collection/<id>         { title, slug } -> creates one (a draft, if the collection has drafts)
// GET    /api/editor/collection/<id>/<slug>  -> { data, body, hash }
// PUT    /api/editor/collection/<id>/<slug>  { data, body, base } -> one commit
// DELETE /api/editor/collection/<id>/<slug>
import type { APIRoute } from 'astro';
import { bad, collections, commitMessage, json, listItems, listPages, reservedSlugs, storage } from '../../server/context';
import { sha256 } from '../../core/storage';
import { parseMarkdown, writeMarkdown } from '../../core/frontmatter';
import { slugProblem } from '../../core/pages';
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

export const GET: APIRoute = async ({ params }) => {
  const c = find(params.id);
  if (!c) return bad('no such collection', 404);
  if (!params.slug) return json({ items: await listItems(c) });
  if (!SLUG.test(params.slug)) return bad('not found', 404);
  const raw = await storage().readFile(file(c, params.slug));
  if (raw === null) return bad('not found', 404);
  return json({ ...parseMarkdown(raw), hash: await sha256(raw) });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const c = find(params.id);
  if (!c || params.slug) return bad('no such collection', 404);
  const body = await request.json().catch(() => null);
  const title = plainText(String(body?.title ?? '')).trim();
  const slug = String(body?.slug ?? '').trim();
  if (!title) return bad('Give it a title.');
  const existing = [...(await listItems(c)).map((i) => i.slug), ...(await listPages()).map((p) => p.slug)];
  const problem = SLUG.test(slug) ? slugProblem(slug, { existing, reserved: reservedSlugs() }) : 'Use letters, numbers and dashes in the URL.';
  if (problem) return bad(problem, 409);
  const data: Record<string, unknown> = { title };
  for (const [k, f] of Object.entries(c.fields)) if (f.type === 'date') data[k] = new Date().toISOString().slice(0, f.time === false ? 10 : 19);
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
  if (content === raw) return json({ ok: true, unchanged: true, hash: await sha256(raw) });
  try {
    const result = await storage().commit({ message: commitMessage(`Edit ${name(c)} ${slug} via site editor`, locals), files: [{ path: file(c, slug), content }] });
    return json({ ok: true, result, hash: await sha256(content) });
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
