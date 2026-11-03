// GET  /api/editor/images?q=   -> image library (recursive listing of imagesDir)
// POST /api/editor/images (multipart: file, alt) -> stages/writes the upload, returns its URL.
import type { APIRoute } from 'astro';
import { bad, json, opts, publicUrl, storage } from '../../server/context';
export const prerender = false;

const IMAGE_RE = /\.(jpe?g|png|webp|gif|svg|avif)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

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
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const all: { src: string; name: string; size?: number }[] = [];
  await listImages(opts.uploadsDir, 0, all, 400);
  await listImages(opts.imagesDir, 0, all, 2000);
  const seen = new Set<string>();
  const images = all.filter((i) => !seen.has(i.src) && seen.add(i.src)).filter((i) => !q || i.src.toLowerCase().includes(q));
  return json({ images: images.slice(0, 300), total: images.length });
};

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('missing file');
  if (file.size > MAX_BYTES) return bad('file too large (max 10 MB)');
  const ext = MIME_EXT[file.type] ?? (file.name.match(IMAGE_RE)?.[1] ?? '').toLowerCase().replace('jpeg', 'jpg');
  if (!ext) return bad('unsupported image type');
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
  const stamp = new Date().toISOString().slice(0, 10);
  const existing = new Set((await storage().listDir(opts.uploadsDir)).map((e) => e.name));
  let name = `${base}.${ext}`;
  for (let i = 2; existing.has(name); i++) name = `${base}-${i}.${ext}`;
  const path = `${opts.uploadsDir}/${stamp}-${name}`;
  await storage().putAsset(path, new Uint8Array(await file.arrayBuffer()));
  return json({ src: publicUrl(path), path, pending: opts.storage === 'github' });
};
