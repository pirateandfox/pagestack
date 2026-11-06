// GET  /api/editor/pages   -> { pages }
// POST /api/editor/pages   { title, slug, copyOf?, template? } -> creates a draft page.
import type { APIRoute } from 'astro';
import { opts, bad, clean, commitMessage, json, listPages, pagePath, readPage, reservedSlugs, serializePage, storage, templates, validate } from '../../server/context';
import { copyPage, newPage, slugProblem } from '../../core/pages';
import type { PageDoc } from '../../runtime';
export const prerender = false;

export const GET: APIRoute = async () => json({ pages: await listPages() });

export const POST: APIRoute = async ({ request, locals }) => {
  if (opts.pages === false) return bad('This site has no block pages.', 404);
  let body: any;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const title = String(body?.title ?? '').trim();
  const slug = String(body?.slug ?? '').trim();
  if (!title) return bad('Give the page a title.');
  const pages = await listPages();
  const problem = slugProblem(slug, { existing: pages.map((p) => p.slug), reserved: reservedSlugs() });
  if (problem) return bad(problem, 409);

  let page: PageDoc;
  let keep: PageDoc | null = null;
  if (body.copyOf) {
    const source = await readPage(String(body.copyOf));
    if (!source) return bad('The page to copy no longer exists.', 404);
    keep = source.page;
    page = copyPage(source.page, title);
  } else if (body.template != null) {
    const template = templates[Number(body.template)];
    if (!template) return bad('Unknown template.');
    page = newPage(title, template.create({ title }));
  } else page = newPage(title);

  page = clean(page, locals, keep);
  const problems = validate(page);
  if (problems.length) return bad(`invalid page: ${problems.join('; ')}`, 500);
  try {
    const result = await storage().commit({ message: commitMessage(`Add page ${slug}`, locals), files: [{ path: pagePath(slug), content: serializePage(page) }] });
    return json({ ok: true, slug, result }, 201);
  } catch (e: any) { return bad(`Could not create the page: ${e.message}`, 500); }
};
