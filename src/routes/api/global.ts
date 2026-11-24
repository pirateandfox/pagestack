// Site-wide documents the host declares (menus, footer…): a JSON file edited with a form.
// GET /api/editor/global/<id>  -> { doc, hash }
// PUT /api/editor/global/<id>  { doc, base } -> keys outside the schema are preserved.
import type { APIRoute } from 'astro';
import { bad, commitMessage, globals, json, storage } from '../../server/context';
import { sha256 } from '../../core/storage';
import { sanitizeFields } from '../../core/sanitize';
import { fillRequired, missingFields, missingMessage } from '../../core/required';
export const prerender = false;

const hasOwn = (id: string | undefined) => !!id && Object.hasOwn(globals, id);

export const GET: APIRoute = async ({ params }) => {
  if (!hasOwn(params.id)) return bad('no such document', 404);
  const raw = await storage().readFile(globals[params.id!].file);
  return json({ doc: raw ? JSON.parse(raw) : {}, hash: raw ? await sha256(raw) : null });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!hasOwn(params.id)) return bad('no such document', 404);
  const def = globals[params.id!];
  const body = await request.json().catch(() => null);
  if (!body?.doc || typeof body.doc !== 'object') return bad('invalid document');
  const raw = await storage().readFile(def.file);
  if (raw && body.base && body.base !== await sha256(raw)) return json({ error: 'This changed since you opened it. Reload to get the latest version.' }, 409);
  let merged = { ...(raw ? JSON.parse(raw) : {}) };
  const cleaned = sanitizeFields(body.doc as Record<string, unknown>, def.fields);
  for (const key of Object.keys(def.fields)) if (key in cleaned) merged[key] = cleaned[key];
  merged = fillRequired(def.fields, merged);
  const missing = missingFields(def.fields, merged);
  if (missing.length) return bad(missingMessage(missing));
  const content = JSON.stringify(merged, null, 2) + '\n';
  try {
    const result = await storage().commit({ message: commitMessage(`Edit ${def.label} via site editor`, locals), files: [{ path: def.file, content }] });
    return json({ ok: true, result, hash: await sha256(content) });
  } catch (e: any) { return bad(`save failed: ${e.message}`, 500); }
};
