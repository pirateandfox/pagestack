// The Go live button, in every screen's top bar. Hidden unless the site has a live branch
// (`github.live`): then saves wait on staging, the button counts them, and one click puts them all
// on the public site. It refreshes itself after any save, wherever on the screen that happened.
import { dialog, toast } from './ui';

interface Pending { enabled: true; branch: string; live: string; count: number; changes: { sha: string; message: string; author: string; date: string }[]; stagingUrl: string | null }

const btn = document.getElementById('ps-live') as HTMLButtonElement | null;
let state: Pending | null = null;

function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function draw() {
  if (!btn || !state) return;
  btn.hidden = false;
  const n = state.count;
  btn.disabled = n === 0;
  btn.textContent = 'Go live';
  if (n) { const b = document.createElement('span'); b.className = 'ps-live__count'; b.textContent = String(n); btn.append(b); }
  btn.title = n ? `${n} saved change${n === 1 ? '' : 's'} not on the live site yet` : 'Everything saved is on the live site';
}

let inflight: Promise<void> | null = null;
async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch('/api/editor/live', { headers: { accept: 'application/json' } });
      const data = await r.json();
      if (data?.enabled) { state = data; draw(); }
    } catch { /* offline or signed out: leave the button as it was */ }
    finally { inflight = null; }
  })();
  return inflight;
}

async function goLive() {
  await refresh();
  if (!state?.count) return;
  const body = document.createElement('div');
  const intro = document.createElement('p');
  intro.textContent = `${state.count} saved change${state.count === 1 ? '' : 's'} will go on the public site. It updates a few minutes after you confirm.`;
  const list = document.createElement('ul'); list.className = 'ps-live__list';
  for (const c of state.changes) {
    const li = document.createElement('li');
    const what = document.createElement('span'); what.textContent = c.message;
    const meta = document.createElement('span'); meta.className = 'ps-muted'; meta.textContent = [c.author, ago(c.date)].filter(Boolean).join(' · ');
    li.append(what, meta); list.append(li);
  }
  body.append(intro, list);
  if (state.count > state.changes.length) { const more = document.createElement('p'); more.className = 'ps-muted'; more.textContent = `…and ${state.count - state.changes.length} earlier.`; body.append(more); }
  if (state.stagingUrl) {
    const p = document.createElement('p'); const a = document.createElement('a');
    a.href = state.stagingUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'See them on the staging site first ↗';
    p.append(a); body.append(p);
  }
  dialog('Go live?', body, [
    { label: 'Cancel' },
    {
      label: 'Go live', kind: 'primary', run: async () => {
        const r = await fetch('/api/editor/live', { method: 'POST', headers: { accept: 'application/json' } });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { toast(data.error ?? 'Could not go live.', 'error'); return false; }
        if (data.nothing) toast('Everything saved was already live.', 'info');
        else toast(`Live. ${data.count} change${data.count === 1 ? ' is' : 's are'} on the way to the site; it updates in a few minutes.`, 'ok', { href: data.url });
        await refresh();
      },
    },
  ], { wide: true });
}

if (btn) {
  btn.addEventListener('click', goLive);
  // Saves are writes to the editor API from many screens; recount after any that succeeds.
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (res.ok && method !== 'GET' && /\/api\/editor\/(?!live|auth\/)/.test(url)) setTimeout(refresh, 300);
    return res;
  };
  window.addEventListener('focus', () => { refresh(); });
  refresh();
}
