// Guards /edit/* and /api/editor/*. Public pages are untouched (and don't exist in SSR anyway:
// they're prerendered). Uploads the build doesn't have are served by routes/uploaded.ts.
import { defineMiddleware } from 'astro:middleware';
import { activeUser, opts, secret, storage, publicUrl } from './context';
import { SESSION_COOKIE, clearCookieHeader, readSession } from '../core/auth';
import { roleOf } from '../core/users';
import { rateLimiter } from '../core/ratelimit';

const PUBLIC = [/^\/edit\/login\/?$/, /^\/edit\/enroll\/?$/, /^\/api\/editor\/auth\//];
const authAttempts = rateLimiter({ limit: 30, windowMs: 5 * 60_000 });

const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function clientIp(ctx: { request: Request; clientAddress: string }): string {
  const fromProxy = opts.clientIpHeader && ctx.request.headers.get(opts.clientIpHeader);
  if (fromProxy) return fromProxy.split(',')[0].trim();
  try { return ctx.clientAddress; } catch { return 'unknown'; }
}

/** Writes come from our own pages. Covers proxy logins too, where SameSite is not ours to set. */
function crossSite(request: Request, url: URL): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === (process.env.EDITOR_ORIGIN || url.origin).replace(/\/$/, '')) return false;
  try { return new URL(origin).host !== request.headers.get('host'); } catch { return true; }
}

/**
 * The block editor's preview frame runs the site's own scripts (tabs, accordions) but nothing from
 * other origins: no analytics counting editors, no captchas or chat widgets inside the editor.
 */
const SITE_SCRIPTS_ONLY = "; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:";

function harden(res: Response, url: URL, sandbox: boolean, frame = false): Response {
  const h = res.headers;
  try {
    h.set('x-robots-tag', 'noindex');
    h.set('cache-control', 'no-store');
    h.set('x-content-type-options', 'nosniff');
    h.set('x-frame-options', 'SAMEORIGIN');
    h.set('referrer-policy', 'same-origin');
    h.set('cross-origin-opener-policy', 'same-origin');
    h.set('content-security-policy', `frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'${sandbox ? '; sandbox allow-scripts allow-forms allow-popups' : ''}${frame ? SITE_SCRIPTS_ONLY : ''}`);
    if ((process.env.EDITOR_ORIGIN || url.origin).startsWith('https:')) h.set('strict-transport-security', 'max-age=31536000');
  } catch { /* an immutable Response, e.g. a redirect from a host's own middleware */ }
  return res;
}

let warned = false;

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (ctx.isPrerendered) return next(); // public pages, which never carry a session
  const { pathname } = ctx.url;
  const { request } = ctx;
  const isEditor = pathname === '/edit' || pathname.startsWith('/edit/') || pathname.startsWith('/api/editor/');

  if (!isEditor) return next();

  // A form POST here is the Preview button: an unsaved draft shown in its own tab, walled off from the session.
  const sandbox = pathname.startsWith('/edit/preview') && request.method === 'POST' && !(request.headers.get('content-type') ?? '').includes('json');
  const frame = request.method === 'GET' && /^\/edit\/preview(-item)?\//.test(pathname) && opts.previewScripts !== 'all';
  const done = (res: Response) => harden(res, ctx.url, sandbox, frame);

  if (opts.command === 'build' && !warned) {
    warned = true;
    if (opts.auth === 'passkey' && !process.env.EDITOR_ORIGIN) console.warn('[pagestack] Set EDITOR_ORIGIN to the public https origin: without it invite links trust the Host header, and behind a proxy cookies may not be marked Secure.');
  }
  if (crossSite(request, ctx.url)) return done(json({ error: 'cross-site request refused' }, 403));

  if (pathname.startsWith('/api/editor/auth/') && request.method === 'POST') {
    const { ok, retryAfter } = authAttempts(clientIp(ctx));
    if (!ok) return done(json({ error: 'Too many attempts. Try again in a few minutes.' }, 429, { 'retry-after': String(retryAfter) }));
  }

  if (opts.auth === 'passkey' && !PUBLIC.some((re) => re.test(pathname))) {
    const session = await readSession(request.headers.get('cookie'), secret());
    const user = session && await activeUser(session.sub);
    if (!user) {
      // A valid session for someone who was removed ends here, without waiting for it to expire.
      const headers: Record<string, string> = session ? { 'set-cookie': clearCookieHeader(SESSION_COOKIE, ctx.url.protocol === 'https:') } : {};
      if (pathname.startsWith('/api/')) return done(json({ error: 'unauthenticated' }, 401, headers));
      return done(new Response(null, { status: 302, headers: { ...headers, location: `/edit/login?next=${encodeURIComponent(pathname)}` } }));
    }
    ctx.locals.editorUser = { id: user.id, name: user.name, role: roleOf(user) };
  } else if (opts.auth === 'none-behind-proxy') {
    // Identity comes from the proxy that already authenticated the request (Cloudflare Access,
    // oauth2-proxy, …). No identity means the request didn't come through it.
    const h = request.headers;
    const shared = process.env.EDITOR_PROXY_SECRET;
    if (shared && h.get('x-editor-proxy-secret') !== shared) return done(json({ error: 'not from the proxy' }, 403));
    const who = h.get('cf-access-authenticated-user-email') || h.get('x-forwarded-user') || h.get('x-forwarded-email');
    if (!who && opts.command === 'build') return done(json({ error: 'no identity from the proxy' }, 401));
    if (who) ctx.locals.editorUser = { id: who, name: who, role: 'admin' };
  }
  const res = await next();
  // The item frame is sandboxed with no scripts, so the site's scripts there would only fail
  // (one console error each); leave them out.
  if (!sandbox && pathname.startsWith('/edit/preview-item/') && (res.headers.get('content-type') ?? '').includes('text/html')) {
    const html = (await res.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const headers = new Headers(res.headers); headers.delete('content-length');
    return done(new Response(html, { status: res.status, headers }));
  }
  return done(res);
});

export { publicUrl };
