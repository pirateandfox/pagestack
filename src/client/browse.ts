// Browse (/edit/site): keeps the bar in step with the page in the frame.
//
// Links inside the frame are caught and sent through /api/editor/browse, so an item opens through
// its preview (its latest saved version) instead of the copy this editor was built with, and the
// "Edit this page" button always points at whatever is showing. The address bar tracks the site
// path (/edit/site?path=…), so Back, Forward and reload work.
interface Resolved {
  path: string;
  kind: 'page' | 'item' | 'live' | 'snapshot';
  frame: string;
  edit: string | null;
  label?: string;
  builtAt?: string;
  savedAt?: string | null;
}

const frame = document.getElementById('ps-browse-frame') as HTMLIFrameElement;
const pathEl = document.getElementById('ps-browse-path')!;
const note = document.getElementById('ps-browse-note')!;
const edit = document.getElementById('ps-browse-edit') as HTMLAnchorElement;
let current = (window as any).__PS_BROWSE__ as Resolved;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function drawBar(r: Resolved) {
  pathEl.textContent = r.path;
  pathEl.title = r.path;
  edit.hidden = !r.edit;
  if (r.edit) edit.href = r.edit;
  note.classList.remove('is-stale');
  note.title = '';
  if (r.kind === 'page' || r.kind === 'item' || r.kind === 'live') {
    note.textContent = 'Latest saved version';
  } else if (r.builtAt && r.savedAt && Date.parse(r.savedAt) > Date.parse(r.builtAt)) {
    note.textContent = `⚠ As of ${when(r.builtAt)}. May not show changes saved since.`;
    note.title = 'This page is the copy built into the editor. Changes saved after that show here once the editor is redeployed, and on the public site after Go live.';
    note.classList.add('is-stale');
  } else {
    note.textContent = '';
  }
}

async function lookup(path: string): Promise<Resolved | null> {
  try {
    const r = await fetch(`/api/editor/browse?path=${encodeURIComponent(path)}`, { headers: { accept: 'application/json' } });
    if (r.status === 401) { location.href = `/edit/login?next=${encodeURIComponent(location.pathname + location.search)}`; return null; }
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * Point the frame somewhere without adding to the tab's history: Browse keeps its own entries
 * (one per site page, in the address bar), so Back goes back a page, not back inside the frame.
 */
function show(url: string) {
  document.body.classList.add('is-loading');
  try { frame.contentWindow!.location.replace(url); } catch { frame.src = url; }
}

/** Show a site path: resolve it, point the frame at it, and (unless from history) record it. */
async function go(path: string, hash = '', push = true) {
  document.body.classList.add('is-loading'); // the lookup itself can take a moment on a cold server
  const r = await lookup(path);
  if (!r) { show(path + hash); return; }
  current = r;
  drawBar(r);
  if (push) history.pushState({ path: r.path }, '', `/edit/site?path=${encodeURIComponent(r.path)}`);
  show(r.frame + hash);
}

/** The site path the frame is showing, from its own address. */
function framePath(): string | null {
  try {
    const loc = frame.contentWindow!.location;
    if (loc.pathname.startsWith('/edit/preview')) return null; // a preview: `current` already says which page
    return loc.pathname;
  } catch { return null; }
}

function isModified(e: MouseEvent) { return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0; }

function wire() {
  let doc: Document;
  try { doc = frame.contentDocument!; } catch { return; }
  if (!doc) return;
  if (doc.title) document.title = doc.title;
  doc.addEventListener('click', (e) => {
    if (e.defaultPrevented || isModified(e)) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    const url = new URL(a.href, doc.baseURI);
    e.preventDefault();
    if (url.origin !== location.origin) { window.open(url.href, '_blank', 'noopener'); return; }
    if (url.pathname === '/edit' || url.pathname.startsWith('/edit/') || url.pathname.startsWith('/api/')) { location.href = url.href; return; }
    if (a.target === '_blank') { window.open(`/edit/site?path=${encodeURIComponent(url.pathname)}`, '_blank'); return; }
    void go(url.pathname, url.hash);
  });
}

frame.addEventListener('load', () => {
  document.body.classList.remove('is-loading');
  wire();
  // Got here some other way (a form, a script, a redirect): bring the bar and address up to date.
  const p = framePath();
  if (p && p !== current.path && p.replace(/\/$/, '') !== current.path.replace(/\/$/, '')) {
    void lookup(p).then((r) => {
      if (!r) return;
      current = r;
      drawBar(r);
      history.replaceState({ path: r.path }, '', `/edit/site?path=${encodeURIComponent(r.path)}`);
      if (r.frame !== p) show(r.frame); // an item: show its saved version, not the old copy
    });
  }
});

window.addEventListener('popstate', (e) => {
  const path = (e.state as { path?: string } | null)?.path ?? new URLSearchParams(location.search).get('path') ?? '/';
  void go(path, '', false);
});

// The frame may have finished before this script ran.
try { const d = frame.contentDocument; if (d && d.readyState === 'complete' && d.location.href !== 'about:blank') { document.body.classList.remove('is-loading'); wire(); } } catch { document.body.classList.remove('is-loading'); }

history.replaceState({ path: current.path }, '', `/edit/site?path=${encodeURIComponent(current.path)}`);
drawBar(current);
// The first resolve came with the page; ask again for the snapshot dates the server left out.
if (current.kind === 'snapshot') void lookup(current.path).then((r) => { if (r && r.path === current.path) { current = r; drawBar(r); } });
