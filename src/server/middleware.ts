// Guards /edit/* and /api/editor/*. Public pages are untouched (and don't exist in SSR anyway:
// they're prerendered). In github mode it also serves uploads that are staged but not committed.
import { defineMiddleware } from 'astro:middleware';
import { opts, secret, storage, publicUrl } from './context';
import { readSession } from '../core/auth';

const PUBLIC = [/^\/edit\/login\/?$/, /^\/edit\/enroll\/?$/, /^\/api\/editor\/auth\//];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { pathname } = ctx.url;
  const isEditor = pathname === '/edit' || pathname.startsWith('/edit/') || pathname.startsWith('/api/editor/');

  // Staged uploads (github storage) — served until the next save commits them.
  if (!isEditor && opts.storage === 'github') {
    const pending = storage().pendingAsset(opts.publicDir + pathname);
    if (pending) return new Response(pending, { headers: { 'content-type': mime(pathname), 'cache-control': 'no-store' } });
  }
  if (!isEditor) return next();

  if (opts.auth === 'passkey' && !PUBLIC.some((re) => re.test(pathname))) {
    const session = await readSession(ctx.request.headers.get('cookie'), secret());
    if (!session) {
      if (pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { 'content-type': 'application/json' } });
      return ctx.redirect(`/edit/login?next=${encodeURIComponent(pathname)}`);
    }
    ctx.locals.editorUser = session;
  }
  const res = await next();
  res.headers.set('x-robots-tag', 'noindex');
  res.headers.set('cache-control', 'no-store');
  return res;
});

function mime(p: string) {
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}
export { publicUrl };
