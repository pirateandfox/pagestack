// Stateless signing for sessions, WebAuthn challenges and invite links. Everything is an
// HMAC-SHA256 token `base64url(json).base64url(mac)` with an expiry inside the payload, so the
// server needs no session store: the only secret is EDITOR_SECRET.
const te = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface Signed<T> { payload: T; exp: number }

/** Sign a payload that expires in `ttlSeconds`. */
export async function sign<T extends object>(payload: T, secret: string, ttlSeconds: number, now = Date.now()): Promise<string> {
  if (!secret || secret.length < 16) throw new Error('EDITOR_SECRET must be at least 16 characters');
  const body = b64url(te.encode(JSON.stringify({ payload, exp: Math.floor(now / 1000) + ttlSeconds })));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), te.encode(body)));
  return `${body}.${b64url(mac)}`;
}

/** Verify a token; returns the payload or null when tampered / expired / malformed. */
export async function verify<T = unknown>(token: string | undefined | null, secret: string, now = Date.now()): Promise<T | null> {
  if (!token || !secret) return null;
  const i = token.indexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i), mac = token.slice(i + 1);
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), unb64url(mac), te.encode(body));
    if (!ok) return null;
    const parsed = JSON.parse(new TextDecoder().decode(unb64url(body))) as Signed<T>;
    if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < now) return null;
    return parsed.payload;
  } catch { return null; }
}

export function randomChallenge(bytes = 32): string {
  const buf = new Uint8Array(bytes); crypto.getRandomValues(buf); return b64url(buf);
}

// ---- cookies ----
export const SESSION_COOKIE = 'ps_session';
export const SESSION_TTL = 60 * 60 * 12; // 12h

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) { const [k, ...v] = part.trim().split('='); if (k) out[k] = decodeURIComponent(v.join('=')); }
  return out;
}
export function cookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
export const clearCookieHeader = (name: string, secure: boolean) => cookieHeader(name, '', 0, secure);

// ---- typed tokens ----
/** `cred`: the passkey this session was opened with (sessions end when it is removed). */
export interface SessionPayload { kind: 'session'; sub: string; name: string; cred?: string }
export interface ChallengePayload { kind: 'challenge'; challenge: string; purpose: 'login' | 'register'; invite?: InvitePayload }
/** `id` makes an invite single-use: it's recorded on the credential created from it. */
export interface InvitePayload { kind: 'invite'; id: string; name: string; email: string; role?: 'admin' | 'editor' }

export const createSession = (user: { id: string; name: string }, secret: string, cred?: string) => sign<SessionPayload>({ kind: 'session', sub: user.id, name: user.name, ...(cred ? { cred } : {}) }, secret, SESSION_TTL);
export const readSession = async (cookieHeaderValue: string | null, secret: string) => {
  const p = await verify<SessionPayload>(parseCookies(cookieHeaderValue)[SESSION_COOKIE], secret);
  return p?.kind === 'session' ? p : null;
};
export const CHALLENGE_TTL = 300;
export const createChallengeToken = (challenge: string, purpose: ChallengePayload['purpose'], secret: string, invite?: InvitePayload) => sign<ChallengePayload>({ kind: 'challenge', challenge, purpose, invite }, secret, CHALLENGE_TTL);
export const readChallengeToken = async (token: string, secret: string) => { const p = await verify<ChallengePayload>(token, secret); return p?.kind === 'challenge' ? p : null; };
export const INVITE_TTL = 60 * 60 * 24 * 3; // 3 days
export const createInvite = (name: string, email: string, secret: string, ttlSeconds = INVITE_TTL, now = Date.now(), role?: InvitePayload['role']) => sign<InvitePayload>({ kind: 'invite', id: randomChallenge(12), name: name.trim(), email: email.trim().toLowerCase(), ...(role ? { role } : {}) }, secret, ttlSeconds, now);
export const readInvite = async (token: string, secret: string) => { const p = await verify<InvitePayload>(token, secret); return p?.kind === 'invite' ? p : null; };

/** Where to go after login: a path on this site only. Browsers read `/\\host` as `//host`. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) return '/edit';
  try { return new URL(next, 'http://x').host === 'x' ? next : '/edit'; } catch { return '/edit'; }
}
