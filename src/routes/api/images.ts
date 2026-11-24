// GET    /api/editor/images?q=         -> image library (recursive listing of imagesDir)
// GET    /api/editor/images?used=<src> -> { used: [{ title, href }] } where an image appears
// POST   /api/editor/images (multipart: file) -> stages/writes the upload, returns its URL.
// DELETE /api/editor/images { src, force? } -> removes it; 409 with `used` unless forced.
import type { APIRoute } from 'astro';
import { bad, commitMessage, json, listPages, opts, publicUrl, storage, whereUsed } from '../../server/context';
import { IMAGE_RE, MAX_BYTES, MIME_EXT, acceptImage, imagePath, libraryOrder } from '../../core/media';
export const prerender = false;

/** Images under a folder, in library order, at most 7 folders deep. */
function listImages(dir: string, files: { name: string; size?: number }[], limit: number) {
  return files.filter((f) => IMAGE_RE.test(f.name) && f.name.split('/').length <= 7)
    .sort((a, b) => libraryOrder(a.name, b.name)).slice(0, limit)
    .map((f) => ({ src: publicUrl(`${dir}/${f.name}`), name: f.name.split('/').pop()!, size: f.size }));
}

export const GET: APIRoute = async ({ url }) => {
  const used = url.searchParams.get('used');
  if (used) return json({ used: await whereUsed(used) });
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 300, 2000);
  const files = await storage().listTree([opts.uploadsDir, opts.imagesDir]);
  const uploads = listImages(opts.uploadsDir, files[opts.uploadsDir], 2000);
  const all = [...uploads, ...listImages(opts.imagesDir, files[opts.imagesDir], 4000 - uploads.length)];
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
