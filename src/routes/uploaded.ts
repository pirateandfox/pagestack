// Uploads the deployed editor doesn't have as files: staged on the uploads branch, or committed
// since this editor build (it doesn't rebuild on every save). Existing files are served as static
// assets before a request gets here; on a miss the platform would otherwise answer with the
// site's static 404 page without running any of our code (Workers does), so this is a real route.
// Signed-in editors only: drafts show these images, and visitors shouldn't spend the API quota.
import type { APIRoute } from 'astro';
import { activeUser, opts, secret, storage } from '../server/context';
import { readSession } from '../core/auth';
import { EXT_MIME, IMAGE_RE } from '../core/media';
export const prerender = false;

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export const GET: APIRoute = async ({ params, request }) => {
  const rel = params.path ?? '';
  if (!IMAGE_RE.test(rel) || rel.split('/').some((s) => s === '..' || s === '')) return notFound();
  if (opts.auth === 'passkey') {
    const session = await readSession(request.headers.get('cookie'), secret());
    if (!session || !await activeUser(session.sub, session.cred)) return notFound(); // removed people too
  }
  const bytes = await storage().asset(`${opts.uploadsDir.replace(/\/$/, '')}/${rel}`).catch(() => undefined);
  if (!bytes) return notFound();
  return new Response(bytes as BodyInit, { headers: {
    'content-type': EXT_MIME[rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex',
    // SVG is an image here, never a document that runs script.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  } });
};
