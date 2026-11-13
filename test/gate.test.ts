import { describe, expect, it } from 'vitest';
import { gateSitePage } from '../src/server/gate';
import { createSession, SESSION_COOKIE } from '../src/core/auth';

const SECRET = 'x'.repeat(32);
const o = { auth: 'passkey' as const, secret: () => SECRET };
const req = (path: string, init: { dest?: string; cookie?: string; method?: string } = {}) =>
  new Request(`https://editor.example${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.dest ? { 'sec-fetch-dest': init.dest } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

describe('gateSitePage', () => {
  it('leaves editor routes, build assets and files to the normal handler', async () => {
    for (const p of ['/edit', '/edit/site', '/api/editor/auth/me', '/_astro/x.js', '/images/a.jpg', '/favicon.svg', '/_image']) {
      expect(await gateSitePage(req(p, { dest: 'document' }), o)).toBeNull();
    }
  });

  it('sends a page opened directly to Browse', async () => {
    const res = await gateSitePage(req('/about/', { dest: 'document' }), o);
    expect(res?.status).toBe(302);
    expect(res?.headers.get('location')).toBe('/edit/site?path=%2Fabout%2F');
    expect((await gateSitePage(req('/', { dest: 'document' }), o))?.headers.get('location')).toBe('/edit/site?path=%2F');
  });

  it('needs a session for a page loaded any other way', async () => {
    const res = await gateSitePage(req('/about/', { dest: 'iframe' }), o);
    expect(res?.headers.get('location')).toBe(`/edit/login?next=${encodeURIComponent('/edit/site?path=%2Fabout%2F')}`);
    expect(await gateSitePage(req('/about/index.html'), o)).not.toBeNull();
    const cookie = `${SESSION_COOKIE}=${await createSession({ id: 'u', name: 'U' }, SECRET)}`;
    expect(await gateSitePage(req('/about/', { dest: 'iframe', cookie }), o)).toBeNull();
    expect(await gateSitePage(req('/about/', { dest: 'iframe', cookie: `${SESSION_COOKIE}=forged.value` }), o)).not.toBeNull();
  });

  it('trusts the proxy when auth is none-behind-proxy, and ignores non-GET', async () => {
    expect(await gateSitePage(req('/about/', { dest: 'iframe' }), { ...o, auth: 'none-behind-proxy' })).toBeNull();
    expect(await gateSitePage(req('/about/', { dest: 'document', method: 'POST' }), o)).toBeNull();
  });
});
