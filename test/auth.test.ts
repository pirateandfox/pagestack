import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHALLENGE_TTL, INVITE_TTL, SESSION_COOKIE, SESSION_TTL, b64url, cookieHeader, clearCookieHeader, createChallengeToken, createInvite, createSession, parseCookies, randomChallenge, readChallengeToken, readInvite, readSession, sign, unb64url, verify } from '../src/core/auth';

const SECRET = 'unit-test-secret-0123456789';

describe('signing', () => {
  it('round-trips a payload and rejects tampering, wrong secrets and expiry', async () => {
    const now = 1_700_000_000_000;
    const token = await sign({ hello: 'world' }, SECRET, 60, now);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verify(token, SECRET, now)).toEqual({ hello: 'world' });
    expect(await verify(token, SECRET, now + 59_000)).toEqual({ hello: 'world' });
    expect(await verify(token, SECRET, now + 61_000)).toBeNull();
    expect(await verify(token, 'another-secret-0123456789', now)).toBeNull();
    const [body, mac] = token.split('.');
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ payload: { hello: 'evil' }, exp: 9_999_999_999 })));
    expect(await verify(`${forged}.${mac}`, SECRET, now)).toBeNull();
    expect(await verify(`${body}.${mac.slice(0, -2)}AA`, SECRET, now)).toBeNull();
    expect(await verify('garbage', SECRET, now)).toBeNull();
    expect(await verify(undefined, SECRET, now)).toBeNull();
    expect(await verify(token, '', now)).toBeNull();
  });
  it('insists on a real secret', async () => {
    await expect(sign({}, 'short', 10)).rejects.toThrow(/at least 16/);
  });
  it('base64url helpers round-trip arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const s = b64url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(unb64url(s)).toEqual(bytes);
  });
  it('challenges are random and long enough', () => {
    const a = randomChallenge(), b = randomChallenge();
    expect(a).not.toBe(b);
    expect(unb64url(a).length).toBe(32);
  });
});

describe('cookies & sessions', () => {
  it('parses cookie headers', () => {
    expect(parseCookies('a=1; ase_session=x%3Dy; b=2=3')).toEqual({ a: '1', ase_session: 'x=y', b: '2=3' });
    expect(parseCookies(null)).toEqual({});
  });
  it('writes HttpOnly, SameSite cookies, Secure only on https', () => {
    expect(cookieHeader('c', 'v', 10, true)).toBe('c=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=10; Secure');
    expect(cookieHeader('c', 'v', 10, false)).not.toContain('Secure');
    expect(clearCookieHeader('c', false)).toContain('Max-Age=0');
  });
  it('session tokens carry the user and are read back from the cookie header', async () => {
    const token = await createSession({ id: 'u_1', name: 'Jane' }, SECRET);
    const header = `${cookieHeader(SESSION_COOKIE, token, SESSION_TTL, false).split(';')[0]}; other=1`;
    expect(await readSession(header, SECRET)).toEqual({ kind: 'session', sub: 'u_1', name: 'Jane' });
    expect(await readSession(header, 'wrong-secret-0123456789')).toBeNull();
    expect(await readSession(null, SECRET)).toBeNull();
    expect(SESSION_TTL).toBe(12 * 3600);
  });
  it('a token of one kind is not accepted as another', async () => {
    const session = await createSession({ id: 'u', name: 'n' }, SECRET);
    expect(await readChallengeToken(session, SECRET)).toBeNull();
    expect(await readInvite(session, SECRET)).toBeNull();
    const challenge = await createChallengeToken('abc', 'login', SECRET);
    expect(await readSession(`${SESSION_COOKIE}=${challenge}`, SECRET)).toBeNull();
  });
});

describe('challenge and invite tokens', () => {
  it('challenge tokens remember purpose and invite, and expire quickly', async () => {
    const invite = { kind: 'invite' as const, id: 'inv1', name: 'Jane', email: 'jane@example.com' };
    const t = await createChallengeToken('ch4ll', 'register', SECRET, invite);
    expect(await readChallengeToken(t, SECRET)).toEqual({ kind: 'challenge', challenge: 'ch4ll', purpose: 'register', invite });
    expect(CHALLENGE_TTL).toBe(300);
    expect(await verify(t, SECRET, Date.now() + (CHALLENGE_TTL + 2) * 1000)).toBeNull();
  });
  it('invites get a unique id and a normalised email', async () => {
    const a = await readInvite(await createInvite('  Jane Doe ', 'Jane@Example.COM', SECRET), SECRET);
    const b = await readInvite(await createInvite('Jane Doe', 'jane@example.com', SECRET), SECRET);
    expect(a).toMatchObject({ kind: 'invite', name: 'Jane Doe', email: 'jane@example.com' });
    expect(a!.id).not.toBe(b!.id);
    expect(INVITE_TTL).toBe(3 * 86400);
    const now = Date.now();
    const old = await createInvite('J', 'j@e.com', SECRET, INVITE_TTL, now - (INVITE_TTL + 5) * 1000);
    expect(await readInvite(old, SECRET)).toBeNull();
  });
  it('the CLI produces an invite the server accepts', async () => {
    const bin = path.resolve(__dirname, '../bin/invite.mjs');
    const run = (env: Record<string, string>, ...args: string[]) => spawnSync(process.execPath, [bin, ...args], { env: { ...process.env, EDITOR_SECRET: '', ...env }, encoding: 'utf8' });
    const ok = run({ EDITOR_SECRET: SECRET }, '--name', 'Jane Doe', '--email', 'Jane@Example.com', '--origin', 'https://example.com/', '--days', '1');
    expect(ok.status).toBe(0);
    const url = new URL(ok.stdout.trim());
    expect(url.origin + url.pathname).toBe('https://example.com/edit/enroll');
    const invite = await readInvite(url.searchParams.get('invite')!, SECRET);
    expect(invite).toMatchObject({ kind: 'invite', name: 'Jane Doe', email: 'jane@example.com' });
    expect(await verify(url.searchParams.get('invite')!, SECRET, Date.now() + 86400 * 1000 + 5000)).toBeNull();
    expect(run({ EDITOR_SECRET: 'short' }, '--name', 'J', '--email', 'j@e.com', '--origin', 'https://x.y').status).toBe(2);
    expect(run({ EDITOR_SECRET: SECRET }, '--name', 'J').status).toBe(2);
  });
});
