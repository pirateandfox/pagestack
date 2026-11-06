// GET    /api/editor/images?q=         -> image library (recursive listing of imagesDir)
// GET    /api/editor/images?used=<src> -> { used: [{ title, href }] } where an image appears
// POST   /api/editor/images (multipart: file) -> stages/writes the upload, returns its URL.
// DELETE /api/editor/images { src, force? } -> removes it; 409 with `used` unless forced.
import type { APIRoute } from 'astro';
import { bad, commitMessage, json, listPages, opts, publicUrl, storage, whereUsed } from '../../server/context';
import { IMAGE_RE, MAX_BYTES, MIME_EXT, acceptImage, imagePath } from '../../core/media';
export const prerender = false;

async function listImages(dir: string, depth: number, out: { src: string; name: string; size?: number }[], limit: number) {
  if (out.length >= limit || depth > 6) return;
  const entries = await storage().listDir(dir);
  // newest upload folders first: sort dirs descending (2026 before 2020), files alphabetically
  entries.sort((a, b) => (a.type === b.type ? (a.type === 'dir' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)) : a.type === 'dir' ? -1 : 1));
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = `${dir}/${e.name}`;
    if (e.type === 'dir') await listImages(p, depth + 1, out, limit);
    else if (IMAGE_RE.test(e.name)) out.push({ src: publicUrl(p), name: e.name, size: e.size });
  }
}

export const GET: APIRoute = async ({ url }) => {
  const used = url.searchParams.get('used');
  if (used) return json({ used: await whereUsed(used) });
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 300, 2000);
  const all: { src: string; name: string; size?: number }[] = [];
  await listImages(opts.uploadsDir, 0, all, 2000);
  await listImages(opts.imagesDir, 0, all, 4000);
  const seen = new Set<string>();
  const images = all.filter((i) => !seen.has(i.src) && seen.add(i.src)).filter((i) => !q || i.src.toLowerCase().includes(q));
  return json({ images: images.slice(0, limit), total: images.length });
};

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('missing file');
  if (file.size > MAX_BYTES) return bad('file too large (max 10 MB)');
  const claimed = MIME_EXT[file.type] ?? (file.name.match(IMAGE_RE)?.[1] ?? '').toLowerCase().replace('jpeg', 'jpg');
  if (!claimed) return bad('unsupported image type');
  const { bytes, ext, error } = acceptImage(new Uint8Array(await file.arrayBuffer()), claimed);
  if (error) return bad(error);
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
  const stamp = new Date().toISOString().slice(0, 10);
  const existing = new Set((await storage().listDir(opts.uploadsDir)).map((e) => e.name));
  let name = `${stamp}-${base}.${ext}`;
  for (let i = 2; existing.has(name); i++) name = `${stamp}-${base}-${i}.${ext}`;
  const path = `${opts.uploadsDir}/${name}`;
  await storage().putAsset(path, bytes!);
  return json({ src: publicUrl(path), path, pending: opts.storage === 'github' });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const path = imagePath(String(body?.src ?? ''), opts.publicDir, [opts.imagesDir, opts.uploadsDir]);
  if (!path) return bad('That is not an image in the library.');
  const used = await whereUsed(body.src);
  if (used.length && !body.force) return json({ error: 'That image is in use.', used }, 409);
  try {
    const result = await storage().commit({ message: commitMessage(`Delete image ${path.split('/').pop()}`, locals), files: [], deletes: [path] });
    return json({ ok: true, result });
  } catch (e: any) { return bad(`Could not delete it: ${e.message}`, 500); }
};
