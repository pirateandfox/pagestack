// GET    /api/editor/page/<slug>             -> { page, hash }
// GET    /api/editor/page/<slug>?revisions=1 -> { revisions }
// GET    /api/editor/page/<slug>?rev=<sha>   -> { page } as of that commit
// PUT    /api/editor/page/<slug>   { page, base, slug? } -> saves via the storage adapter (one commit).
//        `slug` also moves the page: new file, old file gone, a redirect added, all in that commit.
// DELETE /api/editor/page/<slug>   { base } -> removes the page (one commit; git keeps it).
//        `base` is the hash the editor loaded; a mismatch means someone else saved first (409).
import type { APIRoute } from 'astro';
import { bad, clean, commitMessage, json, listPages, opts, pageName, pagePath, readPage, reservedSlugs, serializePage, slugRe, storage, validate } from '../../server/context';
import { addRedirect, slugProblem } from '../../core/pages';
import { isSha } from '../../core/storage';
import type { FileChange } from '../../core/storage';
export const prerender = false;

const STALE = 'The page changed since you opened it. Reload to get the latest version.';

export const GET: APIRoute = async ({ params, url }) => {
  const slug = params.slug || 'index';
  if (!slugRe.test(slug) || slug.includes('..')) return bad('no such page', 404);
  if (url.searchParams.has('revisions')) return json({ revisions: await storage().history(pagePath(slug)) });
  const rev = url.searchParams.get('rev');
  if (rev !== null) {
    if (!isSha(rev)) return bad('bad revision');
    const raw = await storage().readAt(pagePath(slug), rev);
    return raw === null ? bad('no such revision', 404) : json({ page: JSON.parse(raw) });
  }
  const r = await readPage(slug);
  if (!r) return bad('no such page', 404);
  return json({ slug, page: r.page, hash: r.hash });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug || 'index';
  if (!slugRe.test(slug) || slug.includes('..')) return bad('no such page', 404);
  let body: any;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const { page, base, message, slug: nextSlug } = body ?? {};
  const problems = validate(page);
  if (problems.length) return bad(`invalid page: ${problems.join('; ')}`);
  const current = await readPage(slug);
  if (!current) return bad('no such page', 404);
  if (base && base !== current.hash) return json({ error: STALE, hash: current.hash }, 409);
  // Once someone has saved a sample page, it is theirs: Hide/Delete sample content leave it alone.
  const { sample: _sample, ...saved } = clean(page, locals, current.page);
  const content = serializePage(saved);

  const moving = typeof nextSlug === 'string' && nextSlug !== slug;
  const files: FileChange[] = [{ path: pagePath(moving ? nextSlug : slug), content }];
  let deletes: string[] | undefined;
  if (moving) {
    if (slug === 'index') return bad('The home page always lives at /.');
    const problem = slugProblem(nextSlug, { existing: (await listPages()).map((p) => p.slug), reserved: reservedSlugs() });
    if (problem) return bad(problem, 409);
    deletes = [pagePath(slug)];
    const redirects = await storage().readFile(opts.redirectsFile);
    if (redirects !== null) files.push({ path: opts.redirectsFile, content: addRedirect(redirects, slug, nextSlug) });
  }
  const subject = message || (moving ? `Move ${slug} to ${nextSlug} via site editor` : `Edit ${pageName(slug)} via site editor`);
  try {
    const result = await storage().commit({ message: commitMessage(subject, locals), files, deletes });
    const after = await readPage(moving ? nextSlug : slug);
    return json({ ok: true, result, hash: after?.hash ?? null, storage: opts.storage, slug: moving ? nextSlug : slug });
  } catch (e: any) {
    return bad(`save failed: ${e.message}`, 500);
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const slug = params.slug || 'index';
  if (slug === 'index') return bad('The home page cannot be deleted.');
  if (!slugRe.test(slug) || slug.includes('..')) return bad('no such page', 404);
  const body = await request.json().catch(() => ({} as any));
  const current = await readPage(slug);
  if (!current) return bad('no such page', 404);
  if (body?.base && body.base !== current.hash) return json({ error: STALE }, 409);
  try {
    const result = await storage().commit({ message: commitMessage(`Delete page ${slug}`, locals), files: [], deletes: [pagePath(slug)] });
    return json({ ok: true, result });
  } catch (e: any) { return bad(`delete failed: ${e.message}`, 500); }
};
