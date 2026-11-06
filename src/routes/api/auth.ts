// /api/editor/auth/<action> — passkey login, enrolment via invite, logout, invites.
// Everything here is reachable without a session except `invite` (and `me` reports the session).
import type { APIRoute } from 'astro';
import { activeUser, bad, json, opts, secret } from '../../server/context';
import { AuthError, loginOptions, loginVerify, registerOptions, registerVerify, relyingParty } from '../../server/webauthn';
import { SESSION_COOKIE, SESSION_TTL, INVITE_TTL, clearCookieHeader, cookieHeader, createInvite, readSession, safeNext } from '../../core/auth';
import { roleOf } from '../../core/users';
export const prerender = false;

export const ALL: APIRoute = async ({ params, request, url }) => {
  const action = params.action;
  const { secure } = relyingParty(url);
  if (action === 'logout') {
    const headers = { 'set-cookie': clearCookieHeader(SESSION_COOKIE, secure) };
    if (request.method === 'GET') return new Response(null, { status: 303, headers: { ...headers, location: '/edit/login' } });
    return json({ ok: true }, 200, headers);
  }
  if (action === 'me') {
    const s = opts.auth === 'passkey' ? await readSession(request.headers.get('cookie'), secret()) : null;
    return s ? json({ user: { id: s.sub, name: s.name } }) : json({ user: null }, 401);
  }
  if (opts.auth !== 'passkey') return bad(`passkey auth is not enabled (auth: "${opts.auth}")`, 400);
  if (request.method !== 'POST') return bad('method not allowed', 405);
  let body: any = {};
  try { body = await request.json(); } catch { /* empty body is fine for *-options */ }
  try {
    switch (action) {
      case 'login-options': return json(await loginOptions(url));
      case 'login-verify': {
        const { user, session } = await loginVerify(url, String(body.token ?? ''), body.response);
        return json({ ok: true, user: { id: user.id, name: user.name }, next: safeNext(body.next) }, 200, { 'set-cookie': cookieHeader(SESSION_COOKIE, session, SESSION_TTL, secure) });
      }
      case 'register-options': return json(await registerOptions(url, String(body.invite ?? '')));
      case 'register-verify': {
        const { user, session, commit } = await registerVerify(url, String(body.token ?? ''), body.response, body.label);
        return json({ ok: true, user: { id: user.id, name: user.name }, commit }, 200, { 'set-cookie': cookieHeader(SESSION_COOKIE, session, SESSION_TTL, secure) });
      }
      case 'invite': {
        const s = await readSession(request.headers.get('cookie'), secret());
        const inviter = s && await activeUser(s.sub);
        if (!inviter) return bad('unauthenticated', 401);
        if (roleOf(inviter) !== 'admin') return bad('Only admins can invite people.', 403);
        const name = String(body.name ?? '').trim(), email = String(body.email ?? '').trim();
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('name and a valid email are required');
        const token = await createInvite(name, email, secret(), INVITE_TTL, Date.now(), body.role === 'admin' ? 'admin' : 'editor');
        const { origin } = relyingParty(url);
        return json({ url: `${origin}/edit/enroll?invite=${encodeURIComponent(token)}`, expiresIn: INVITE_TTL, invitedBy: s.name });
      }
      default: return bad('unknown action', 404);
    }
  } catch (e: any) {
    if (e instanceof AuthError) return bad(e.message, e.status);
    console.error('[pagestack] auth error', e);
    return bad(`authentication error: ${e?.message ?? e}`, 400);
  }
};
