// The editor controller: wires the preview iframe, left tree, right inspector, inline editing,
// history and saving together. Framework-free on purpose (small, no build-time coupling).
import type { ImageValue, Node, PageDoc, SchemaRegistry } from '../runtime';
import { cloneWithNewIds, newId } from '../runtime';
import { getAt, insertNode, isNodePath, moveNode, nodeAt, nodePathOf, removeNode, setAt, splitNodePath, updateSettings } from '../core/patch';
import { allowedChildTypes, createNode, nodeLabel } from '../core/schema';
import { EditorState } from './state';
import { renderForm } from './form';
import { renderTree } from './tree';
import { InlineEditor } from './inline';
import { pickImage } from './picker';
import previewCss from './preview.css?raw';

interface Boot {
  slug: string; page: PageDoc; hash: string; registry: SchemaRegistry;
  presets: { label: string; description?: string; node: Node }[];
  pages: { slug: string; title: string; url: string }[];
  options: { storage: string; auth: string; siteName: string; user: string | null; pullRequest: boolean; viewUrl: string; interactiveSelector: string };
}
const boot = (window as any).__ASE__ as Boot;
const { registry } = boot;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const iframe = $<HTMLIFrameElement>('#ase-preview');
const state = new EditorState(boot.slug, boot.page, boot.hash);
let selected: string | null = null;
let renderSeq = 0, renderTimer: any = null, previewReady = false;
const iconsField = Object.values(registry).flatMap((s) => Object.values(s.fields)).find((f) => f.type === 'svg' && f.icons)?.icons ?? [];

// ---------- restore a draft ----------
{
  const draft = EditorState.restore(boot.slug, boot.hash);
  if (draft === 'stale') { state.clearDraft(); toast('An older unsaved draft was discarded because the page changed since.', 'warn'); }
  else if (draft) { state.apply(draft.doc, 'restore', false); toast(`Restored your unsaved draft from ${new Date(draft.at).toLocaleString()}.`, 'info'); }
}

// ---------- preview iframe ----------
const idoc = () => iframe.contentDocument!;
const topSections = (doc: Document | DocumentFragment) => Array.from(doc.querySelectorAll<HTMLElement>('[data-ase-node]')).filter((el) => /^sections\.\d+$/.test(el.dataset.aseNode!));

iframe.addEventListener('load', () => {
  const d = idoc();
  const style = d.createElement('style'); style.textContent = previewCss; d.head.append(style);
  d.addEventListener('click', onPreviewClick, true);
  d.addEventListener('submit', (e) => e.preventDefault(), true);
  d.addEventListener('mouseover', onPreviewHover);
  d.addEventListener('mouseleave', () => hover(null));
  d.addEventListener('keydown', onKeydown);
  previewReady = true;
  if (state.dirty) render(); else decorate();
});

function onPreviewHover(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('[data-ase-toolbar], .ase-toolbar')) return;
  hover(t.closest<HTMLElement>('[data-ase-node]'));
}
function hover(el: HTMLElement | null) {
  idoc().querySelectorAll('[data-ase-hover]').forEach((x) => x.removeAttribute('data-ase-hover'));
  if (el) el.setAttribute('data-ase-hover', '');
}
function onPreviewClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('[data-ase-toolbar], .ase-toolbar')) return; // handled by their own listeners
  const field = t.closest<HTMLElement>('[data-ase-field]');
  const node = t.closest<HTMLElement>('[data-ase-node]');
  // Let the page's own interactive bits work (accordion summaries, tab titles…); block navigation.
  const interactive = t.closest(boot.options.interactiveSelector || 'summary');
  if (!interactive) e.preventDefault();
  if (field) {
    e.stopPropagation();
    select(nodePathOf(field.dataset.aseField!), { fromPreview: true });
    const type = field.dataset.aseFieldType;
    if (type === 'image') pickImage(getAt(state.doc, field.dataset.aseField!), (img) => setField(field.dataset.aseField!, img));
    else if (inline.activePath !== field.dataset.aseField) inline.start(field);
    return;
  }
  if (inline.isActive) inline.stop(true);
  if (node) select(node.dataset.aseNode!, { fromPreview: true }); else select(null);
}

const inline = new InlineEditor({
  onStart: () => state.snapshot(),
  onInput: (path, value) => state.apply(setAt(state.doc, path, value), 'inline', false),
  onCommit: (path, value, changed) => { state.apply(setAt(state.doc, path, value), 'inline', false); refreshChrome(); if (changed) scheduleRender(0); },
});

async function render() {
  if (!previewReady) return;
  const seq = ++renderSeq;
  setStatus('Rendering…');
  try {
    const res = await fetch(`/edit/preview/${boot.slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.doc }) });
    if (seq !== renderSeq) return;
    const html = await res.text();
    if (!res.ok) { setStatus(''); toast(`Preview failed: ${html.slice(0, 200)}`, 'error'); return; }
    swap(html);
    setStatus('');
  } catch (e: any) { if (seq === renderSeq) toast(`Preview failed: ${e.message}`, 'error'); }
}
function scheduleRender(ms = 150) { clearTimeout(renderTimer); renderTimer = setTimeout(render, ms); }

/** Swap the preview's sections for the freshly rendered ones (whole-section granularity). */
function swap(html: string) {
  const fresh = new DOMParser().parseFromString(html, 'text/html');
  const next = topSections(fresh);
  const d = idoc();
  const cur = topSections(d);
  const parent = cur[0]?.parentElement ?? d.querySelector('main') ?? d.body;
  const n = Math.max(cur.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = cur[i], b = next[i] ? d.importNode(next[i], true) : null;
    if (a && b) a.replaceWith(b);
    else if (b) { const last = topSections(d).pop(); if (last) last.after(b); else parent.append(b); }
    else if (a) a.remove();
  }
  decorate();
}

/** Re-apply selection highlight + in-page toolbar after the DOM changed. */
function decorate() {
  const d = idoc();
  d.querySelectorAll('[data-ase-selected]').forEach((x) => x.removeAttribute('data-ase-selected'));
  d.querySelectorAll('.ase-toolbar').forEach((x) => x.remove());
  if (selected) {
    const el = d.querySelector<HTMLElement>(`[data-ase-node="${selected}"]`);
    if (el) { el.setAttribute('data-ase-selected', ''); mountToolbar(el); }
  }
}

function mountToolbar(el: HTMLElement) {
  const d = idoc();
  const path = el.dataset.aseNode!;
  const node = nodeAt(state.doc, path)!;
  const top = /^sections\.\d+$/.test(path);
  const tb = d.createElement('div');
  tb.className = 'ase-toolbar' + (top ? ' ase-toolbar--top' : '');
  tb.innerHTML = `${top ? '<span class="ase-grip" title="Drag to reorder">⋮⋮</span>' : ''}<span class="ase-toolbar__label"></span>${top ? '' : '<button type="button" data-act="parent" title="Select parent">↖</button>'}<button type="button" data-act="up" title="Move up">↑</button><button type="button" data-act="down" title="Move down">↓</button><button type="button" data-act="dup" title="Duplicate">⧉</button><button type="button" data-act="del" title="Delete">🗑</button>`;
  tb.querySelector('.ase-toolbar__label')!.textContent = registry[node.type]?.label ?? node.type;
  tb.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { e.preventDefault(); e.stopPropagation(); act(b.dataset.act!); } });
  tb.addEventListener('mousedown', (e) => e.stopPropagation());
  el.prepend(tb);
  if (top) tb.querySelector('.ase-grip')!.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, el));
}

/** Pointer-driven reorder of top-level sections inside the preview. */
function startDrag(e: PointerEvent, el: HTMLElement) {
  e.preventDefault();
  const d = idoc();
  const sections = topSections(d);
  const from = sections.indexOf(el);
  const line = d.createElement('div'); line.className = 'ase-dropline'; d.body.append(line);
  el.classList.add('ase-dragging');
  let to = from;
  const move = (ev: PointerEvent) => {
    const y = ev.clientY + d.defaultView!.scrollY;
    to = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const r = sections[i].getBoundingClientRect();
      const mid = r.top + d.defaultView!.scrollY + r.height / 2;
      if (y < mid) { to = i; break; }
    }
    const ref = sections[Math.min(to, sections.length - 1)];
    const rr = ref.getBoundingClientRect();
    line.style.top = `${(to >= sections.length ? rr.bottom : rr.top) + d.defaultView!.scrollY}px`;
    // auto-scroll near the edges
    const vh = d.defaultView!.innerHeight;
    if (ev.clientY < 60) d.defaultView!.scrollBy(0, -12); else if (ev.clientY > vh - 60) d.defaultView!.scrollBy(0, 12);
  };
  const up = () => {
    d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up);
    line.remove(); el.classList.remove('ase-dragging');
    const dest = to > from ? to - 1 : to;
    if (dest !== from) { state.apply(moveNode(state.doc, `sections.${from}`, 'sections', dest)); selected = `sections.${dest}`; }
    else refreshChrome();
  };
  d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
}

// ---------- selection ----------
function select(path: string | null, opts: { fromPreview?: boolean; scroll?: boolean } = {}) {
  if (path && !isNodePath(path)) path = nodePathOf(path);
  selected = path;
  if (path && !opts.fromPreview && previewReady) {
    const el = idoc().querySelector<HTMLElement>(`[data-ase-node="${path}"]`);
    if (el && opts.scroll !== false) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  refreshChrome();
}
function refreshChrome() {
  if (previewReady) decorate();
  renderTree($('#ase-tree'), state.doc, registry, selected, {
    onSelect: (p) => select(p),
    onMove: (fromPath, toList, toIndex) => { state.apply(moveNode(state.doc, fromPath, toList, toIndex)); selected = `${toList}.${toIndex}`; refreshChrome(); },
  });
  renderInspector();
  $<HTMLButtonElement>('#ase-undo').disabled = !state.canUndo;
  $<HTMLButtonElement>('#ase-redo').disabled = !state.canRedo;
  $<HTMLButtonElement>('#ase-save').disabled = !state.dirty;
  $('#ase-discard').hidden = !state.dirty;
  document.title = `${state.dirty ? '• ' : ''}Edit: ${state.doc.title}`;
}

// ---------- inspector (right panel) ----------
function renderInspector() {
  const root = $('#ase-inspector');
  root.innerHTML = '';
  const node = selected ? nodeAt(state.doc, selected) : null;
  if (!selected || !node) {
    root.innerHTML = `<div class="ase-panel__head"><span>Page</span></div>`;
    const form = document.createElement('div');
    renderForm(form, { label: 'Page', fields: { title: { type: 'text', label: 'Title', default: '' }, description: { type: 'textarea', label: 'Meta description', default: '' }, ogImage: { type: 'text', label: 'Social image URL', default: '', group: 'advanced' } } }, { title: state.doc.title, description: state.doc.description ?? '', ogImage: state.doc.ogImage ?? '' }, {
      onChange: (name, value) => state.apply(setAt(state.doc, name, value)),
      pickImage,
    });
    root.append(form, hint('Click anything in the page to edit it. Drag sections with the ⋮⋮ handle or in the list on the left.'));
    return;
  }
  const schema = registry[node.type];
  const top = /^sections\.\d+$/.test(selected);
  const head = document.createElement('div');
  head.className = 'ase-panel__head';
  head.innerHTML = `<span class="ase-ellipsis"></span><span class="ase-muted ase-type"></span>`;
  head.querySelector('.ase-ellipsis')!.textContent = nodeLabel(node, registry);
  head.querySelector('.ase-type')!.textContent = top ? 'section' : 'block';
  const actions = document.createElement('div');
  actions.className = 'ase-actions';
  actions.innerHTML = `${top ? '' : '<button type="button" data-act="parent" class="ase-btn ase-btn--small ase-btn--ghost">↖ Parent</button>'}<button type="button" data-act="up" class="ase-btn ase-btn--small">↑</button><button type="button" data-act="down" class="ase-btn ase-btn--small">↓</button><button type="button" data-act="dup" class="ase-btn ase-btn--small">Duplicate</button><button type="button" data-act="del" class="ase-btn ase-btn--small ase-btn--danger">Delete</button>`;
  actions.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) act(b.dataset.act!); });
  root.append(head, actions);
  const allowed = allowedChildTypes(node.type, registry);
  if (allowed?.length) {
    const add = document.createElement('div');
    add.className = 'ase-add';
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">+ Add block…</option>${allowed.map((t) => `<option value="${t}">${registry[t].label}</option>`).join('')}`;
    sel.addEventListener('change', () => { if (sel.value) { addBlock(selected!, sel.value); sel.value = ''; } });
    add.append(sel);
    root.append(add);
  }
  const form = document.createElement('div');
  renderForm(form, schema ?? { label: node.type, fields: {} }, node.settings, {
    onChange: (name, value, o) => {
      const path = `${selected}.settings.${name}`;
      state.apply(setAt(state.doc, path, value), 'edit', !o?.live || !liveStarted);
      liveStarted = !!o?.live;
      scheduleRender(o?.live ? 200 : 0);
      if (!o?.live) { liveStarted = false; }
    },
    pickImage,
    pageUrls: boot.pages,
    icons: Object.fromEntries(iconsField.map((i) => [i, i])),
  });
  root.append(form);
}
let liveStarted = false;
const hint = (text: string) => { const p = document.createElement('p'); p.className = 'ase-muted ase-hint'; p.textContent = text; return p; };

// ---------- actions ----------
function act(what: string) {
  if (!selected) return;
  const { listPath, index } = splitNodePath(selected);
  const list: Node[] = getAt(state.doc, listPath) ?? [];
  switch (what) {
    case 'parent': { const p = listPath.replace(/\.blocks$/, ''); select(isNodePath(p) ? p : null); return; }
    case 'up': if (index > 0) { state.apply(moveNode(state.doc, selected, listPath, index - 1)); selected = `${listPath}.${index - 1}`; } break;
    case 'down': if (index < list.length - 1) { state.apply(moveNode(state.doc, selected, listPath, index + 1)); selected = `${listPath}.${index + 1}`; } break;
    case 'dup': { const copy = cloneWithNewIds(nodeAt(state.doc, selected)!); state.apply(insertNode(state.doc, listPath, index + 1, copy)); selected = `${listPath}.${index + 1}`; break; }
    case 'del': {
      const node = nodeAt(state.doc, selected)!;
      if (!confirm(`Delete this ${registry[node.type]?.label ?? node.type}${node.blocks?.length ? ` and its ${node.blocks.length} block(s)` : ''}?`)) return;
      state.apply(removeNode(state.doc, selected));
      const remaining: Node[] = getAt(state.doc, listPath) ?? [];
      selected = remaining.length ? `${listPath}.${Math.min(index, remaining.length - 1)}` : (isNodePath(listPath.replace(/\.blocks$/, '')) ? listPath.replace(/\.blocks$/, '') : null);
      break;
    }
  }
  refreshChrome();
  scheduleRender(0);
}
function addBlock(parentPath: string, type: string) {
  const node = createNode(type, registry);
  if (type === 'container') node.settings = { ...node.settings, boxed: false };
  const listPath = `${parentPath}.blocks`;
  const len = (getAt(state.doc, listPath) ?? []).length;
  state.apply(insertNode(state.doc, listPath, len, node));
  selected = `${listPath}.${len}`;
  refreshChrome(); scheduleRender(0);
}
function setField(fieldPath: string, value: unknown) {
  state.apply(setAt(state.doc, fieldPath, value));
  refreshChrome(); scheduleRender(0);
}

// ---------- add section ----------
$('#ase-add-section').addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLElement;
  document.querySelector('.ase-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'ase-menu';
  menu.innerHTML = boot.presets.map((p, i) => `<button type="button" data-i="${i}"><strong>${p.label}</strong>${p.description ? `<span class="ase-muted">${p.description}</span>` : ''}</button>`).join('') + `<button type="button" data-i="blank"><strong>Blank container</strong><span class="ase-muted">Start from nothing.</span></button>`;
  menu.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('button'); if (!b) return;
    const node = b.dataset.i === 'blank' ? { ...createNode('container', registry), id: newId() } : cloneWithNewIds(boot.presets[Number(b.dataset.i)].node);
    const after = selected ? Number(selected.split('.')[1]) + 1 : state.doc.sections.length;
    state.apply(insertNode(state.doc, 'sections', after, node));
    selected = `sections.${after}`;
    menu.remove();
    refreshChrome(); scheduleRender(0);
    setTimeout(() => select(selected), 400);
  });
  btn.parentElement!.append(menu);
  const close = (ev: MouseEvent) => { if (!menu.contains(ev.target as any) && ev.target !== btn) { menu.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close));
});

// ---------- top bar ----------
$('#ase-undo').addEventListener('click', () => { inline.stop(true); state.undo(); });
$('#ase-redo').addEventListener('click', () => { inline.stop(true); state.redo(); });
$('#ase-discard').addEventListener('click', async () => {
  if (!confirm('Discard all unsaved changes?')) return;
  const r = await (await fetch(`/api/editor/page/${boot.slug}`)).json();
  state.reset(r.page, r.hash);
});
$('#ase-save').addEventListener('click', save);
document.querySelectorAll<HTMLButtonElement>('.ase-top__devices button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.ase-top__devices button').forEach((x) => x.classList.remove('is-active'));
  b.classList.add('is-active');
  $('.ase-stage').dataset.device = b.dataset.device;
}));

async function save() {
  if (!state.dirty) return;
  inline.stop(true);
  const btn = $<HTMLButtonElement>('#ase-save');
  btn.disabled = true; setStatus('Saving…');
  try {
    const res = await fetch(`/api/editor/page/${boot.slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.doc, base: state.hash }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Save failed', 'error'); setStatus(''); refreshChrome(); return; }
    state.markSaved(data.hash);
    const r = data.result;
    if (r.kind === 'github') toast(r.pullRequest ? `Committed and opened a pull request: ${r.pullRequest}` : `Committed ${String(r.commit).slice(0, 7)} to ${r.branch}. The host will rebuild the site.`, 'ok', r.pullRequest || r.url);
    else toast(`Saved to the working tree (${r.files.join(', ')}). Commit it with git when you're happy.`, 'ok');
    setStatus('Saved');
  } catch (e: any) { toast(`Save failed: ${e.message}`, 'error'); setStatus(''); refreshChrome(); }
}

function onKeydown(e: KeyboardEvent) {
  const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? state.redo() : state.undo(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); act('del'); return; }
  if (e.key === 'Escape') select(null);
}
document.addEventListener('keydown', onKeydown);
window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); } });

// ---------- state → UI ----------
state.addEventListener('change', (e) => {
  const source = (e as CustomEvent).detail.source;
  if (source === 'inline') return; // DOM already matches; chrome refreshes on commit
  if (source === 'undo' || source === 'redo' || source === 'restore' || source === 'reset') { inline.stop(false); if (selected && !nodeAt(state.doc, selected)) selected = null; scheduleRender(0); }
  refreshChrome();
});

function setStatus(t: string) { $('#ase-status').textContent = t; }
function toast(text: string, kind: 'ok' | 'info' | 'warn' | 'error', href?: string) {
  const t = document.createElement('div');
  t.className = `ase-toast ase-toast--${kind}`;
  t.textContent = text;
  if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open ↗'; t.append(' ', a); }
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.addEventListener('click', () => t.remove()); t.append(x);
  document.body.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 15000 : 8000);
}

refreshChrome();
