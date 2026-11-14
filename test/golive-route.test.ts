import { beforeEach, describe, expect, it, vi } from 'vitest';

// Publish changes (Go live): editors see what's waiting, only admins put it live.
const state = vi.hoisted(() => ({ goLive: 0 }));
vi.mock('../src/server/context', () => {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  return {
    opts: { github: { repo: 'o/r', branch: 'develop', live: 'main' } },
    storage: () => ({
      pending: async () => ({ branch: 'develop', live: 'main', count: 2, changes: [] }),
      goLive: async () => { state.goLive++; return { commit: 'abc', url: 'u', merged: false }; },
    }),
    json,
    bad: (msg: string, status = 400) => json({ error: msg }, status),
    editorOf: (locals: any) => locals.editorUser,
    isAdmin: (locals: any) => (locals.editorUser?.role ?? 'admin') === 'admin',
  };
});

const { GET, POST } = await import('../src/routes/api/live');
const as = (role?: 'admin' | 'editor') => ({ locals: role ? { editorUser: { id: 'u', name: 'Sam', role } } : {} }) as any;

beforeEach(() => { state.goLive = 0; });

describe('Publish changes', () => {
  it('tells each person whether they may publish', async () => {
    expect(await (await GET(as('editor'))).json()).toMatchObject({ enabled: true, count: 2, canPublish: false });
    expect(await (await GET(as('admin'))).json()).toMatchObject({ canPublish: true });
    expect(await (await GET(as())).json()).toMatchObject({ canPublish: true }); // no sign-in: the owner
  });
  it('refuses editors and lets admins publish', async () => {
    const refused = await POST(as('editor'));
    expect(refused.status).toBe(403);
    expect(state.goLive).toBe(0);
    const ok = await POST(as('admin'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, count: 2, commit: 'abc' });
    expect(state.goLive).toBe(1);
  });
});
