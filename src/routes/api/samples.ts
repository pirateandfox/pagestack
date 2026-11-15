// Sample content a starter ships with (`sample: true` on pages and Markdown items): hide it or delete it.
// GET  /api/editor/samples                      -> { state, pages, items }
// POST /api/editor/samples { action: 'hide' | 'delete' } -> one commit   (admins only)
import type { APIRoute } from 'astro';
import { bad, clean, commitMessage, isAdmin, json, pagePath, readSamples, sampleContent, storage, validate } from '../../server/context';
import { planDelete, planHide, sampleState } from '../../core/samples';
import { StaleWrite } from '../../core/storage';
import type { PageDoc } from '../../runtime';
export const prerender = false;

export const GET: APIRoute = async () => {
  const s = await readSamples();
  return json({
    state: sampleState(s.pages, s.items),
    pages: s.pages.map((p) => ({ slug: p.slug, title: p.page.title, draft: p.slug !== 'index' && p.page.status === 'draft' })),
    items: s.items.map((i) => ({ collection: i.collection, label: i.label, slug: i.slug, title: i.title, draft: i.draft })),
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals)) return bad('Only admins can hide or delete the sample content.', 403);
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== 'hide' && action !== 'delete') return bad('action must be "hide" or "delete"');
  const home = clean(sampleContent.home ?? ({ title: 'Home', sections: [] } as PageDoc), locals);
  const problems = validate(home);
  if (problems.length) return bad(`The site's replacement home page is not valid: ${problems.join('; ')}`, 500);
  const s = await readSamples();
  if (sampleState(s.pages, s.items) === 'none') return json({ ok: true, nothing: true });
  const plan = (action === 'hide' ? planHide : planDelete)({ pages: s.pages, items: s.items, globals: s.globals, config: { ...sampleContent, home }, pagePath, taken: s.slugs });
  if (!plan.files.length && !plan.deletes.length) return json({ ok: true, nothing: true });
  const what = [plan.pages && `${plan.pages} page${plan.pages === 1 ? '' : 's'}`, plan.items && `${plan.items} item${plan.items === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  try {
    const result = await storage().commit({
      message: commitMessage(`${action === 'hide' ? 'Hide' : 'Delete'} sample content${what ? ` (${what})` : ''}`, locals),
      files: plan.files, deletes: plan.deletes, expect: plan.expect,
    });
    return json({ ok: true, result, pages: plan.pages, items: plan.items });
  } catch (e: any) {
    if (e instanceof StaleWrite) return bad('Someone changed the sample content at the same moment. Reload and try again.', 409);
    return bad(`Could not ${action} the sample content: ${e.message}`, 500);
  }
};
