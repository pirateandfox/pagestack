// Saved patterns: reusable blocks kept as one JSON file in the repo.
// GET    /api/editor/patterns              -> { patterns }
// POST   /api/editor/patterns { label, node } -> adds one
// PUT    /api/editor/patterns { id, node } -> new content for a synced pattern and all its copies, one commit
// DELETE /api/editor/patterns?id=<id>      -> removes one
import type { APIRoute } from 'astro';
import { bad, clean, cleanNode, commitMessage, json, opts, pagePath, pageSlugs, patternOk, readPage, readPatterns, serializePage, storage, validate } from '../../server/context';
import { newId } from '../../runtime';
import type { SavedPattern } from '../../core/insert';
import { plainText } from '../../core/sanitize';
import { applySynced } from '../../core/synced';
export const prerender = false;

const write = (patterns: SavedPattern[], subject: string, locals: unknown) =>
  storage().commit({ message: commitMessage(subject, locals), files: [{ path: opts.patternsFile, content: JSON.stringify(patterns, null, 2) + '\n' }] });

export const GET: APIRoute = async () => json({ patterns: await readPatterns() });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const label = String(body?.label ?? '').trim();
  if (!label) return bad('Give the pattern a name.');
  if (!body?.node || !patternOk(body.node)) return bad('That block cannot be saved as a pattern.');
  const pattern: SavedPattern = { id: newId(), label: plainText(label), node: cleanNode(body.node, locals), ...(body.synced ? { synced: true } : {}) };
  const patterns = [...await readPatterns(), pattern];
  try {
    await write(patterns, `Save pattern ${label}`, locals);
    return json({ ok: true, patterns }, 201);
  } catch (e: any) { return bad(`Could not save the pattern: ${e.message}`, 500); }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const all = await readPatterns();
  const old = all.find((p) => p.id === body?.id);
  if (!old?.synced) return bad('no such synced pattern', 404);
  if (!patternOk(body.node)) return bad('That block cannot be saved as a pattern.');
  const { synced: _, ...plain } = body.node;
  const node = cleanNode(plain, locals, old.node);
  const patterns = all.map((p) => (p === old ? { ...p, node } : p));
  const files = [{ path: opts.patternsFile, content: JSON.stringify(patterns, null, 2) + '\n' }];
  const pages: string[] = [];
  for (const slug of await pageSlugs()) {
    const r = await readPage(slug);
    const { doc, changed } = applySynced(r!.page, old.id, node);
    if (!changed) continue;
    const page = clean(doc, locals, { ...r!.page, sections: [...r!.page.sections, old.node] });
    const problems = validate(page);
    if (problems.length) return bad(`${slug}: ${problems.join('; ')}`);
    pages.push(slug);
    files.push({ path: pagePath(slug), content: serializePage(page) });
  }
  try {
    await storage().commit({ message: commitMessage(`Update synced pattern ${old.label} on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`, locals), files });
    return json({ ok: true, patterns, pages });
  } catch (e: any) { return bad(`Could not update the copies: ${e.message}`, 500); }
};

export const DELETE: APIRoute = async ({ url, locals }) => {
  const id = url.searchParams.get('id');
  const all = await readPatterns();
  const patterns = all.filter((p) => p.id !== id);
  if (patterns.length === all.length) return bad('no such pattern', 404);
  try {
    await write(patterns, `Delete pattern ${all.find((p) => p.id === id)!.label}`, locals);
    return json({ ok: true, patterns });
  } catch (e: any) { return bad(`Could not delete the pattern: ${e.message}`, 500); }
};
