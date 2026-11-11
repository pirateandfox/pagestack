// The Users screen.
import { confirmDialog, toast } from './ui';

interface Passkey { id: string; label: string | null; createdAt: string; synced: boolean }
interface User { id: string; name: string; email: string; role: 'admin' | 'editor'; passkeys: Passkey[] }
const list = document.getElementById('ps-users')!;

async function call(method: string, body?: unknown) {
  const res = await fetch('/api/editor/users', { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'That did not work.', 'error'); return load(); }
  draw(data.users);
}
async function load() { const r = await fetch('/api/editor/users'); draw((await r.json()).users ?? []); }

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
load();
