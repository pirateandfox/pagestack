// GET  /api/editor/page/<slug>   -> { page, hash }
// PUT  /api/editor/page/<slug>   { page, base } -> saves via the storage adapter (one commit).
//      `base` is the hash the editor loaded; a mismatch means someone else saved first (409).
import type { APIRoute } from 'astro';
import { bad, json, opts, pagePath, readPage, serializePage, storage, validate } from '../../server/context';
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug || 'index';
  const r = await readPage(slug).catch((e) => { throw e; });
  if (!r) return bad('no such page', 404);
  return json({ slug, page: r.page, hash: r.hash });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug || 'index';
  let body: any;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const { page, base, message } = body ?? {};
  const problems = validate(page);
  if (problems.length) return bad(`invalid page: ${problems.join('; ')}`);
  const current = await readPage(slug);
  if (!current) return bad('no such page', 404);
  if (base && base !== current.hash) return json({ error: 'The page changed since you opened it. Reload to get the latest version.', hash: current.hash }, 409);
  const content = serializePage(page);
  const user = (locals as any).editorUser as { name?: string } | undefined;
  const msg = (message || `Edit ${slug === 'index' ? 'home page' : slug} via site editor`) + (user?.name ? `\n\nEdited by ${user.name}` : '');
  try {
    const result = await storage().commit({ message: msg, files: [{ path: pagePath(slug), content }] });
    const after = await readPage(slug);
    return json({ ok: true, result, hash: after?.hash ?? null, storage: opts.storage });
  } catch (e: any) {
    return bad(`save failed: ${e.message}`, 500);
  }
};
