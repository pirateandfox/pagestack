// The Users screen: people, their passkeys, and invites not used yet.
import { confirmDialog, toast } from './ui';

interface Passkey { id: string; label: string | null; createdAt: string; synced: boolean }
interface User { id: string; name: string; email: string; role: 'admin' | 'editor'; passkeys: Passkey[] }
interface Invite { id: string; name: string; email: string; role: 'admin' | 'editor'; createdAt: string; expiresAt: string; by?: string }
const list = document.getElementById('ps-users')!;
const waiting = document.getElementById('ps-invites');

async function call(method: string, body?: unknown) {
  const res = await fetch('/api/editor/users', { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'That did not work.', 'error'); return load(); }
  draw(data.users); drawInvites(data.invites ?? []);
}
async function load() { const r = await fetch('/api/editor/users'); const d = await r.json(); draw(d.users ?? []); drawInvites(d.invites ?? []); }
// The invite form says when it made a new link.
document.addEventListener('ps:invited', () => { load(); });

const text = (tag: string, s: string, cls?: string) => { const e = document.createElement(tag); e.textContent = s; if (cls) e.className = cls; return e; };

function draw(users: User[]) {
  list.replaceChildren(...users.map((u) => {
    const li = document.createElement('li'); li.dataset.user = u.email;
    const who = document.createElement('div'); who.className = 'ps-pagelist__edit';
    who.append(text('strong', u.name), text('span', `${u.email} · ${u.passkeys.length} ${u.passkeys.length === 1 ? 'passkey' : 'passkeys'}`, 'ps-muted'));
    const keys = document.createElement('div'); keys.className = 'ps-users__keys';
    for (const k of u.passkeys) {
      const b = text('button', `${k.label || (k.synced ? 'Synced passkey' : 'Device passkey')}, added ${k.createdAt.slice(0, 10)} ×`, 'ps-btn ps-btn--small ps-btn--ghost') as HTMLButtonElement;
      b.type = 'button'; b.title = 'Remove this passkey';
      b.addEventListener('click', async () => { if (await confirmDialog('Remove passkey', `${u.name} will not be able to sign in with this passkey any more.${u.passkeys.length === 1 ? ' It is their last one, so they will lose access.' : ''}`, 'Remove', 'danger')) call('DELETE', { credential: k.id }); });
      keys.append(b);
    }
    who.append(keys);
    const role = document.createElement('select'); role.setAttribute('aria-label', `Role for ${u.name}`);
    for (const r of ['editor', 'admin']) role.append(Object.assign(document.createElement('option'), { value: r, textContent: r === 'admin' ? 'Admin' : 'Editor', selected: u.role === r }));
    role.addEventListener('change', () => call('PATCH', { id: u.id, role: role.value }));
    const del = text('button', 'Remove', 'ps-btn ps-btn--small ps-btn--ghost ps-btn--danger') as HTMLButtonElement; del.type = 'button';
    del.addEventListener('click', async () => { if (await confirmDialog('Remove user', `${u.name} loses access within seconds, including any session they have open now.`, 'Remove user', 'danger')) call('DELETE', { id: u.id }); });
    li.append(who, role, del);
    return li;
  }));
}

function timeLeft(iso: string): string {
  const h = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return h >= 24 ? `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} left` : `${h} h left`;
}

function drawInvites(invites: Invite[]) {
  if (!waiting) return;
  waiting.hidden = !invites.length;
  waiting.querySelector('ul')!.replaceChildren(...invites.map((i) => {
    const li = document.createElement('li'); li.dataset.invite = i.email;
    const who = document.createElement('div'); who.className = 'ps-pagelist__edit';
    who.append(text('strong', i.name), text('span', [i.email, i.role === 'admin' ? 'Admin' : 'Editor', timeLeft(i.expiresAt), i.by ? `invited by ${i.by}` : ''].filter(Boolean).join(' · '), 'ps-muted'));
    const del = text('button', 'Withdraw', 'ps-btn ps-btn--small ps-btn--ghost ps-btn--danger') as HTMLButtonElement; del.type = 'button';
    del.addEventListener('click', async () => { if (await confirmDialog('Withdraw invite', `The link sent to ${i.name} stops working at once. You can invite them again later.`, 'Withdraw', 'danger')) call('DELETE', { invite: i.id }); });
    li.append(who, del);
    return li;
  }));
}

load();
