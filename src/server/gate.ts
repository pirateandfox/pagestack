// Site pages on a deployed editor. The editor build carries a built copy of every site page, and
// Cloudflare would hand those files out before the editor's code runs: no sign-in, no editor bar.
// The editor's Worker entry (src/worker.ts) asks here first, for every request.
import { readSession } from '../core/auth';

/** Paths the editor's own middleware already handles (sign-in included). */
const EDITOR = /^\/(edit(\/|$)|api\/editor\/)/;
/** Files with an extension other than .html (styles, scripts, images, fonts) stay as public as on the site. */
const FILE = /\.[a-z0-9]{1,8}$/i;

export interface GateOptions { auth: 'none' | 'passkey' | 'none-behind-proxy'; secret: () => string }

/**
 * null: carry on to the normal handler. Otherwise the response to send instead:
 * a page opened directly goes to Browse (which signs in first); a page loaded any other way (the
 * Browse frame, a fetch) needs a session.
 */
export async function gateSitePage(request: Request, o: GateOptions): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const p = url.pathname;
  if (EDITOR.test(p) || p.startsWith('/_astro/') || p.startsWith('/_image')) return null;
  const last = p.slice(p.lastIndexOf('/') + 1);
  if (FILE.test(last) && !/\.html?$/i.test(last)) return null;
  const browse = `/edit/site?path=${encodeURIComponent(p)}`;
  if (request.headers.get('sec-fetch-dest') === 'document') return redirect(browse);
  if (o.auth !== 'passkey') return null; // behind a proxy, the proxy already signed them in
  const session = await readSession(request.headers.get('cookie'), o.secret()).catch(() => null);
  return session ? null : redirect(`/edit/login?next=${encodeURIComponent(browse)}`);
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
