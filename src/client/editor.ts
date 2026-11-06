// The editor controller: wires the preview iframe, List View, the inserter, the Page/Block sidebar,
// inline editing, history and saving together. Framework-free on purpose (small, no build-time coupling).
import type { Field, Node, PageDoc, SchemaRegistry } from '../runtime';
import { cloneWithNewIds } from '../runtime';
import { getAt, insertNode, isNodePath, moveNode, nodeAt, nodePathOf, pathOfId, removeNode, replaceNode, setAt, splitNodePath } from '../core/patch';
import { transformNode, transformTargets } from '../core/transform';
import { accepts, allowedChildTypes, createNode, nodeLabel } from '../core/schema';
import type { InsertItem, Pattern, SavedPattern } from '../core/insert';
import { insertItems } from '../core/insert';
import { slugProblem } from '../core/pages';
import type { Revision } from '../core/storage';
import { EditorState } from './state';
import { renderForm } from './form';
import { renderTree } from './tree';
import { renderInserter } from './inserter';
import { InlineEditor } from './inline';
import { pickImage } from './picker';
import { icons } from './icons';
import type { MenuItem } from './ui';
import { confirmDialog, dialog, openMenu, promptDialog, toast } from './ui';
import previewCss from './preview.css?raw';

interface Boot {
  slug: string; page: PageDoc; hash: string; registry: SchemaRegistry;
  presets: Pattern[]; patterns: SavedPattern[];
  pageFields: Record<string, Field>;
  pages: { slug: string; title: string; url: string }[];
  reserved: string[];
  options: { storage: string; auth: string; siteName: string; user: string | null; pullRequest: boolean; viewUrl: string; interactiveSelector: string; redirects: boolean };
}
const boot = (window as any).__ASE__ as Boot;
const { registry } = boot;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const iframe = $<HTMLIFrameElement>('#ase-preview');
const state = new EditorState(boot.slug, boot.page, boot.hash);
const isHome = boot.slug === 'index';
let selected: string | null = null;
let tab: 'page' | 'block' = 'page';
let renderSeq = 0, renderTimer: ReturnType<typeof setTimeout> | undefined, previewReady = false;
let renderQueued = false, renderFull = false, leaving = false, saving = false;
/** Field being edited live; one continuous edit is one undo step. */
let livePath: string | null = null;
/** Path to scroll to once the next render lands. */
let reveal: string | null = null;
let patterns = boot.patterns;
const iconsField = Object.values(registry).flatMap((s) => Object.values(s.fields)).find((f) => f.type === 'svg' && f.icons)?.icons ?? [];
const pageLinks = boot.pages.map((p) => ({ url: p.url, title: p.title.split(/\s[-–|]\s/)[0] }));

// ---------- restore a draft ----------
{
  const draft = EditorState.restore(boot.slug, boot.hash);
  if (draft === 'stale') { state.clearDraft(); toast('An older unsaved draft was discarded because the page changed since.', 'warn'); }
  else if (draft) { state.apply(draft.doc, 'restore', false); toast(`Restored your unsaved draft from ${new Date(draft.at).toLocaleString()}.`, 'info'); }
}

// ---------- preview iframe ----------
const idoc = () => iframe.contentDocument!;
const iwin = () => iframe.contentWindow!;
const isTop = (path: string) => /^sections\.\d+$/.test(path);
const topSections = (doc: Document) => Array.from(doc.querySelectorAll<HTMLElement>('[data-ase-node]')).filter((el) => isTop(el.dataset.aseNode!));
const nodeEl = (path: string) => idoc().querySelector<HTMLElement>(`[data-ase-node="${path}"]`);

/** Where sections live in the page, remembered so an emptied page can still be filled. */
let sectionHost: HTMLElement | null = null;
/** Rendered HTML per section, so an update replaces only what changed and widgets elsewhere keep working. */
let lastHtml: string[] = [];

function onPreviewLoad() {
  const d = idoc();
  const style = d.createElement('style'); style.textContent = previewCss; d.head.append(style);
  d.addEventListener('click', onPreviewClick, true);
  d.addEventListener('submit', (e) => e.preventDefault(), true);
  d.addEventListener('mouseover', onPreviewHover);
  d.addEventListener('mousemove', onPreviewMove, { passive: true });
  d.addEventListener('mouseleave', () => { hover(null); showPlus(null); });
  d.addEventListener('keydown', onKeydown);
  iwin().addEventListener('scroll', placeOverlays, { passive: true });
  iwin().addEventListener('resize', placeOverlays, { passive: true });
  sectionHost = topSections(d)[0]?.parentElement ?? d.querySelector('main') ?? d.body;
  d.documentElement.style.setProperty('--ase-ui', String(uiScale));
  previewReady = true;
  if (state.dirty) render(); else { decorate(); seedHtml(); }
}

async function seedHtml() {
  const html = await (await fetch(iframe.src)).text().catch(() => '');
  if (html && !lastHtml.length) lastHtml = topSections(new DOMParser().parseFromString(html, 'text/html')).map((e) => e.outerHTML);
}

function onPreviewHover(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('[data-ase-ui]')) return;
  hover(t.closest<HTMLElement>('[data-ase-node]'));
}
function hover(el: HTMLElement | null) {
  idoc().querySelectorAll('[data-ase-hover]').forEach((x) => x.removeAttribute('data-ase-hover'));
  if (el) el.setAttribute('data-ase-hover', '');
}
function onPreviewClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('[data-ase-ui], [data-ase-toolbar], .ase-popmenu')) return; // handled by their own listeners
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
  onSlash: (fieldPath) => slash(fieldPath),
  pages: pageLinks,
  onStart: () => { state.snapshot(); idoc().body.setAttribute('data-ase-typing', ''); },
  onInput: (path, value) => { state.apply(setAt(state.doc, path, value), 'inline', false); refreshButtons(); },
  onCommit: (path, value, changed) => {
    idoc().body.removeAttribute('data-ase-typing');
    if (changed) state.apply(setAt(state.doc, path, value), 'inline', false); else state.dropSnapshot();
    refreshChrome();
    if (changed || renderQueued) scheduleRender(0);
    renderQueued = false;
  },
});

async function render() {
  if (!previewReady) return;
  // Never swap the element under someone's cursor: this waits for the inline edit to finish.
  if (inline.isActive) { renderQueued = true; return; }
  const seq = ++renderSeq;
  setSaveStatus('Rendering…');
  try {
    const res = await fetch(`/edit/preview/${boot.slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.doc }) });
    if (seq !== renderSeq) return;
    const html = await res.text();
    if (!res.ok) { setSaveStatus(''); toast(`Preview failed: ${html.slice(0, 200)}`, 'error'); return; }
    if (inline.isActive) { renderQueued = true; setSaveStatus(''); return; }
    swap(html);
    setSaveStatus('');
  } catch (e: any) { if (seq === renderSeq) toast(`Preview failed: ${e.message}`, 'error'); }
}
function scheduleRender(ms = 150) { clearTimeout(renderTimer); renderTimer = setTimeout(render, ms); }

/** Update the preview from fresh HTML, section by section (or the whole body for page-level changes). */
function swap(html: string) {
  const fresh = new DOMParser().parseFromString(html, 'text/html');
  const next = topSections(fresh);
  const nextHtml = next.map((e) => e.outerHTML);
  const d = idoc();
  if (renderFull) {
    renderFull = false;
    d.body.innerHTML = fresh.body.innerHTML;
    d.body.className = fresh.body.className;
    sectionHost = topSections(d)[0]?.parentElement ?? d.querySelector('main') ?? d.body;
  } else {
    const cur = topSections(d);
    for (let i = 0; i < Math.max(cur.length, next.length); i++) {
      const a = cur[i], b = next[i];
      if (a && b) { if (nextHtml[i] !== lastHtml[i]) a.replaceWith(d.importNode(b, true)); }
      else if (b) {
        const last = topSections(d).pop();
        const copy = d.importNode(b, true);
        if (last) last.after(copy); else sectionHost!.append(copy);
      } else a?.remove();
    }
  }
  lastHtml = nextHtml;
  decorate();
  if (reveal) { nodeEl(reveal)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); reveal = null; }
}

/** Re-apply selection highlight + overlays after the DOM changed. */
function decorate() {
  const d = idoc();
  d.querySelectorAll('[data-ase-selected]').forEach((x) => x.removeAttribute('data-ase-selected'));
  d.querySelector('.ase-toolbar')?.remove();
  const el = selected ? nodeEl(selected) : null;
  if (el) { el.setAttribute('data-ase-selected', ''); mountToolbar(el); }
  decorateEmpty();
  placeOverlays();
}

/** A page with no blocks yet says what to do next, like a new post in the block editor. */
function decorateEmpty() {
  const d = idoc();
  const empty = !state.doc.sections.length;
  const box = d.querySelector('.ase-empty');
  if (!empty) { box?.remove(); return; }
  if (box) return;
  const div = d.createElement('div');
  div.className = 'ase-empty'; div.setAttribute('data-ase-ui', '');
  div.innerHTML = `<p class="ase-empty__title">This page is empty</p><p>Add your first block to get started.</p><button type="button">${icons.plus} Add block</button>`;
  div.querySelector('button')!.addEventListener('click', () => openInserter({ listPath: 'sections', index: 0 }));
  sectionHost?.append(div);
}

function mountToolbar(el: HTMLElement) {
  const d = idoc();
  const path = el.dataset.aseNode!;
  const node = nodeAt(state.doc, path)!;
  const canAdd = !!allowedChildTypes(node.type, registry)?.length;
  const tb = d.createElement('div');
  tb.className = 'ase-toolbar';
  tb.setAttribute('data-ase-ui', '');
  tb.setAttribute('role', 'toolbar');
  tb.setAttribute('aria-label', 'Block tools');
  tb.innerHTML = `${isTop(path) ? '' : `<button type="button" data-act="parent" title="Select parent block" aria-label="Select parent block">${icons.parent}</button>`}<span class="ase-grip" title="Drag to move">${icons.grip}</span><span class="ase-toolbar__label"></span><button type="button" data-act="up" title="Move up" aria-label="Move up">${icons.up}</button><button type="button" data-act="down" title="Move down" aria-label="Move down">${icons.down}</button>${canAdd ? `<button type="button" data-act="add" title="Add a block inside" aria-label="Add a block inside">${icons.plus}</button>` : ''}<button type="button" data-act="more" title="Options" aria-label="Options">${icons.more}</button>`;
  tb.querySelector('.ase-toolbar__label')!.textContent = registry[node.type]?.label ?? node.type;
  tb.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.act === 'more') openMenu(b, blockMenu(path)); else act(b.dataset.act!);
  });
  tb.addEventListener('mousedown', (e) => e.stopPropagation());
  d.body.append(tb);
  tb.querySelector('.ase-grip')!.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, el));
}

/** Keep the floating pieces next to what they belong to; the page can scroll under them. */
function placeOverlays() {
  if (!previewReady) return;
  const d = idoc();
  const tb = d.querySelector<HTMLElement>('.ase-toolbar');
  const el = selected ? nodeEl(selected) : null;
  if (tb && el) {
    const r = el.getBoundingClientRect();
    const vw = iwin().innerWidth;
    const visible = r.bottom > 0 && r.top < iwin().innerHeight;
    tb.style.visibility = visible ? '' : 'hidden';
    const size = tb.getBoundingClientRect(); // measured, because a scaled preview scales this back up
    tb.style.top = `${Math.max(4, r.top - size.height - 6)}px`;
    tb.style.left = `${Math.max(4, Math.min(r.left, vw - size.width - 4))}px`;
  }
  const line = d.querySelector<HTMLElement>('.ase-insertline');
  if (line) {
    const y = target ? insertionY(target) : null;
    line.style.display = y === null ? 'none' : '';
    if (y !== null) line.style.top = `${y}px`;
  }
}

/** Screen position of an insertion point in a vertical list. */
function insertionY(t: Target): number | null {
  const kids = siblings(t.listPath);
  if (kids.length) {
    const at = kids[t.index];
    return at ? at.getBoundingClientRect().top : kids[kids.length - 1].getBoundingClientRect().bottom;
  }
  return t.listPath === 'sections' ? null : nodeEl(t.listPath.replace(/\.blocks$/, ''))?.getBoundingClientRect().bottom ?? null;
}

function siblings(listPath: string): HTMLElement[] {
  const re = new RegExp(`^${listPath.replace(/\./g, '\\.')}\\.(\\d+)$`);
  return Array.from(idoc().querySelectorAll<HTMLElement>('[data-ase-node]')).filter((e) => re.test(e.dataset.aseNode!)).sort((a, b) => Number(a.dataset.aseNode!.match(re)![1]) - Number(b.dataset.aseNode!.match(re)![1]));
}

/** Drag a block to reorder it among its siblings, in whichever direction they are laid out. */
function startDrag(e: PointerEvent, el: HTMLElement) {
  e.preventDefault();
  const d = idoc();
  const path = el.dataset.aseNode!;
  const { listPath, index: from } = splitNodePath(path);
  const kids = siblings(listPath);
  if (kids.length < 2) return;
  const [a, b] = [kids[0].getBoundingClientRect(), kids[1].getBoundingClientRect()];
  const horizontal = Math.abs(a.top - b.top) < a.height / 2;
  const line = d.createElement('div'); line.className = `ase-dropline${horizontal ? ' ase-dropline--v' : ''}`; line.setAttribute('data-ase-ui', ''); d.body.append(line);
  el.classList.add('ase-dragging');
  let to = from;
  const move = (ev: PointerEvent) => {
    let best = 0, dist = Infinity;
    kids.forEach((k, i) => { const r = k.getBoundingClientRect(); const dd = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)); if (dd < dist) { dist = dd; best = i; } });
    const r = kids[best].getBoundingClientRect();
    const after = horizontal ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
    to = best + (after ? 1 : 0);
    if (horizontal) { line.style.left = `${after ? r.right : r.left}px`; line.style.top = `${r.top}px`; line.style.height = `${r.height}px`; }
    else { line.style.top = `${after ? r.bottom : r.top}px`; line.style.left = `${r.left}px`; line.style.width = `${r.width}px`; }
    const vh = iwin().innerHeight; // auto-scroll near the edges
    if (ev.clientY < 60) iwin().scrollBy(0, -12); else if (ev.clientY > vh - 60) iwin().scrollBy(0, 12);
  };
  const up = () => {
    d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up);
    line.remove(); el.classList.remove('ase-dragging');
    const dest = to > from ? to - 1 : to;
    if (dest !== from) { selected = `${listPath}.${dest}`; state.apply(moveNode(state.doc, path, listPath, dest)); scheduleRender(0); } else refreshChrome();
  };
  d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
}

// ---------- the + between sections ----------
let plusRaf = 0;
function onPreviewMove(e: MouseEvent) {
  if (plusRaf) return;
  const { clientY, target: t } = e;
  plusRaf = requestAnimationFrame(() => {
    plusRaf = 0;
    if (inline.isActive || (t as HTMLElement).closest?.('.ase-toolbar, [data-ase-toolbar]')) { showPlus(null); return; }
    const secs = topSections(idoc());
    let index: number | null = null, y = 0;
    secs.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      if (Math.abs(clientY - r.top) < 18) { index = i; y = r.top; }
      else if (i === secs.length - 1 && Math.abs(clientY - r.bottom) < 18) { index = i + 1; y = r.bottom; }
    });
    showPlus(index === null ? null : { index, y });
  });
}
function showPlus(at: { index: number; y: number } | null) {
  if (!previewReady) return;
  const d = idoc();
  let plus = d.querySelector<HTMLElement>('.ase-plus');
  if (!at) { if (plus) plus.hidden = true; return; }
  if (!plus) {
    plus = d.createElement('button');
    plus.type = 'button'; plus.className = 'ase-plus'; plus.setAttribute('data-ase-ui', ''); plus.title = 'Add block'; plus.setAttribute('aria-label', 'Add block'); plus.innerHTML = icons.plus;
    plus.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openInserter({ listPath: 'sections', index: Number(plus!.dataset.index) }); plus!.hidden = true; });
    d.body.append(plus);
  }
  plus.hidden = false; plus.dataset.index = String(at.index); plus.style.top = `${at.y}px`;
}

// ---------- selection ----------
function select(path: string | null, opts: { fromPreview?: boolean; scroll?: boolean } = {}) {
  if (path && !isNodePath(path)) path = nodePathOf(path);
  selected = path;
  tab = path ? 'block' : 'page';
  if (path && !opts.fromPreview && previewReady && opts.scroll !== false) nodeEl(path)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  refreshChrome();
}

function refreshButtons() {
  const dirty = state.dirty;
  const draft = state.doc.status === 'draft';
  $<HTMLButtonElement>('#ase-undo').disabled = !state.canUndo;
  $<HTMLButtonElement>('#ase-redo').disabled = !state.canRedo;
  const save = $<HTMLButtonElement>('#ase-save');
  save.disabled = !dirty || saving;
  save.textContent = draft ? 'Save draft' : 'Save';
  save.classList.toggle('ase-btn--primary', !draft);
  save.classList.toggle('ase-btn--ghost', draft);
  const publish = $<HTMLButtonElement>('#ase-publish');
  publish.hidden = !draft;
  publish.disabled = saving;
  $('#ase-discard').hidden = !dirty;
  $('#ase-view').hidden = draft || boot.page.status === 'draft';
  $('#ase-draft-pill').hidden = !draft;
  $('#ase-title').textContent = state.doc.title;
  document.title = `${dirty ? '• ' : ''}Edit: ${state.doc.title}`;
}

function refreshChrome(opts: { inspector?: boolean } = {}) {
  if (previewReady) decorate();
  renderTree($('#ase-tree'), state.doc, registry, selected, {
    onSelect: (p) => select(p),
    onMove: (fromPath, toList, toIndex) => {
      const id = nodeAt(state.doc, fromPath)!.id;
      const next = moveNode(state.doc, fromPath, toList, toIndex);
      selected = pathOfId(next, id) ?? null;
      state.apply(next);
      scheduleRender(0);
    },
    canDrop: (fromPath, toList) => {
      if (toList === fromPath || toList.startsWith(`${fromPath}.`)) return false;
      const type = nodeAt(state.doc, fromPath)!.type;
      return accepts(parentTypeOf(toList), type, registry);
    },
    onMenu: (path, anchor) => { select(path, { scroll: false }); openMenu(anchor, blockMenu(path)); },
  });
  if (opts.inspector !== false) renderInspector();
  refreshButtons();
}

const parentTypeOf = (listPath: string): string | null => (listPath === 'sections' ? null : nodeAt(state.doc, listPath.replace(/\.blocks$/, ''))?.type ?? null);

// ---------- sidebar ----------
function renderInspector() {
  const root = $('#ase-inspector');
  root.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'ase-tabs'; tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = `<button type="button" role="tab" data-tab="page" aria-selected="${tab === 'page'}">Page</button><button type="button" role="tab" data-tab="block" aria-selected="${tab === 'block'}">Block</button>`;
  tabs.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (b) { tab = b.dataset.tab as typeof tab; renderInspector(); } });
  root.append(tabs);
  const node = selected ? nodeAt(state.doc, selected) : null;
  if (tab === 'page') renderPageTab(root);
  else if (node) renderBlockTab(root, node, selected!);
  else root.append(hint('Select a block in the page to see its settings.'));
  const syncedNode = selected ? nodeAt(state.doc, selected) : null;
  if (tab === 'block' && syncedNode?.synced) root.append(hint('This block is a copy of a synced pattern. Edits stay on this page until you choose Update all copies in its ⋮ menu.'));
}

const formCallbacks = {
  pickImage,
  pageUrls: pageLinks,
  icons: Object.fromEntries(iconsField.map((i) => [i, i])),
};

/** One field change: a live change streams, and undo sees the whole edit as one step. */
function applyField(path: string, value: unknown, live: boolean | undefined, field?: Field) {
  state.apply(setAt(state.doc, path, value), 'field', livePath !== path);
  livePath = live ? path : null;
  scheduleRender(live ? 200 : 0);
  if (field?.type === 'image' && !live) renderInspector();
}

function renderBlockTab(root: HTMLElement, node: Node, path: string) {
  const schema = registry[node.type];
  const head = document.createElement('div');
  head.className = 'ase-blockhead';
  const name = document.createElement('strong'); name.textContent = schema?.label ?? node.type;
  head.append(name);
  if (schema?.description) { const d = document.createElement('p'); d.className = 'ase-muted'; d.textContent = schema.description; head.append(d); }
  root.append(breadcrumbs(path), head);
  const actions = document.createElement('div');
  actions.className = 'ase-actions';
  const allowed = allowedChildTypes(node.type, registry);
  actions.innerHTML = `${allowed?.length ? `<button type="button" data-act="add" class="ase-btn ase-btn--small">${icons.plus} Add block</button>` : ''}<button type="button" data-act="dup" class="ase-btn ase-btn--small">Duplicate</button><button type="button" data-act="del" class="ase-btn ase-btn--small ase-btn--danger">Delete</button>`;
  actions.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) act(b.dataset.act!); });
  root.append(actions);
  const form = document.createElement('div');
  renderForm(form, schema ?? { label: node.type, fields: {} }, node.settings, {
    ...formCallbacks,
    onChange: (name, value, o) => applyField(`${path}.settings.${name}`, value, o?.live, schema?.fields[name]),
  });
  root.append(form);
}

/** Page › Hero › Button; each step selects that block. */
function breadcrumbs(path: string): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'ase-crumbs'; nav.setAttribute('aria-label', 'Block position');
  const add = (label: string, to: string | null, current = false) => {
    if (nav.childElementCount) nav.append(' › ');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; if (current) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => select(to));
    nav.append(b);
  };
  add('Page', null);
  const parts = path.split('.');
  for (let i = 2; i <= parts.length; i += 2) {
    const p = parts.slice(0, i).join('.');
    const n = nodeAt(state.doc, p);
    if (n) add(registry[n.type]?.label ?? n.type, p, p === path);
  }
  return nav;
}

function renderPageTab(root: HTMLElement) {
  const doc = state.doc;
  const draft = doc.status === 'draft';
  const summary = document.createElement('div');
  summary.className = 'ase-summary';
  const row = (label: string, value: string, button?: { text: string; id: string; run: () => void; disabled?: boolean }) => {
    const r = document.createElement('div'); r.className = 'ase-summary__row';
    const l = document.createElement('span'); l.className = 'ase-muted'; l.textContent = label;
    const v = document.createElement('span'); v.textContent = value; v.className = 'ase-ellipsis';
    r.append(l, v);
    if (button) { const b = document.createElement('button'); b.type = 'button'; b.id = button.id; b.className = 'ase-linkbtn'; b.textContent = button.text; b.disabled = !!button.disabled; b.addEventListener('click', button.run); r.append(b); }
    summary.append(r);
  };
  row('Status', draft ? 'Draft' : 'Published', draft ? undefined : { text: 'Switch to draft', id: 'ase-unpublish', run: () => publish(false), disabled: isHome });
  row('URL', boot.options.viewUrl, isHome ? undefined : { text: 'Change', id: 'ase-change-url', run: changeUrl });
  root.append(summary);

  const form = document.createElement('div');
  const fields: Record<string, Field> = {
    title: { type: 'text', label: 'Title', default: '' },
    description: { type: 'textarea', label: 'Description', default: '', help: 'Shown in search results and link previews.' },
    ogImage: { type: 'image', label: 'Social image', asUrl: true, default: '' },
  };
  renderForm(form, { label: 'Page', fields }, { title: doc.title, description: doc.description ?? '', ogImage: doc.ogImage ?? '' }, {
    ...formCallbacks,
    onChange: (name, value, o) => applyField(name, value, o?.live, fields[name]),
  });
  root.append(form);

  if (Object.keys(boot.pageFields).length) {
    const layout = document.createElement('div');
    renderForm(layout, { label: 'Layout', fields: boot.pageFields }, state.doc.layout ?? {}, {
      ...formCallbacks,
      onChange: (name, value, o) => { renderFull = !o?.live; applyField(`layout.${name}`, value, o?.live, boot.pageFields[name]); },
    });
    root.append(layout);
  }

  const tools = document.createElement('div');
  tools.className = 'ase-actions';
  tools.innerHTML = `<button type="button" id="ase-revisions" class="ase-btn ase-btn--small">Revisions</button>${isHome ? '' : '<button type="button" id="ase-delete-page" class="ase-btn ase-btn--small ase-btn--danger">Delete page</button>'}`;
  tools.querySelector('#ase-revisions')!.addEventListener('click', showRevisions);
  tools.querySelector('#ase-delete-page')?.addEventListener('click', deletePage);
  root.append(tools, hint('Click anything in the page to edit it. Press ? for keyboard shortcuts.'));
}
const hint = (text: string) => { const p = document.createElement('p'); p.className = 'ase-muted ase-hint'; p.textContent = text; return p; };

// ---------- block actions ----------
function blockMenu(path: string): MenuItem[] {
  const run = (what: string) => () => { selected = path; act(what); };
  return [
    { label: 'Duplicate', hint: '⇧⌘D', run: run('dup') },
    { label: 'Copy', hint: '⌘C', run: run('copy') },
    { label: 'Cut', hint: '⌘X', run: run('cut') },
    { label: 'Paste after', hint: '⌘V', run: run('paste'), disabled: !readClipboard() },
    { label: 'Add before', hint: '⌥⌘T', run: run('before'), separator: true },
    { label: 'Add after', hint: '⌥⌘Y', run: run('after') },
    ...transformItems(path),
    ...syncedItems(path),
    { label: 'Save as pattern…', run: run('pattern'), separator: true },
    { label: 'Delete', hint: 'Del', run: run('del'), danger: true, separator: true },
  ];
}

function transformItems(path: string): MenuItem[] {
  const node = nodeAt(state.doc, path);
  if (!node) return [];
  const parent = parentTypeOf(splitNodePath(path).listPath);
  return transformTargets(node, parent, registry).slice(0, 8).map((t, i) => ({
    label: `Turn into ${t.label}`, separator: i === 0,
    run: () => { selected = path; tab = 'block'; state.apply(replaceNode(state.doc, path, transformNode(nodeAt(state.doc, path)!, t.type, registry))); scheduleRender(0); },
  }));
}

function syncedItems(path: string): MenuItem[] {
  const node = nodeAt(state.doc, path);
  if (!node?.synced || !patterns.some((p) => p.id === node.synced)) return [];
  return [
    { label: 'Update all copies', separator: true, run: () => updateCopies(path) },
    { label: 'Detach from pattern', run: () => { const { synced: _, ...plain } = nodeAt(state.doc, path)!; state.apply(replaceNode(state.doc, path, plain)); renderInspector(); } },
  ];
}

/** This block becomes the pattern, on every page. The page is saved first, so nothing here is lost. */
async function updateCopies(path: string) {
  const node = nodeAt(state.doc, path)!;
  const name = patterns.find((p) => p.id === node.synced)?.label ?? 'this pattern';
  if (!await confirmDialog('Update all copies', `Every page using "${name}" gets this version, in one commit. This page is saved first.`, 'Update all copies')) return;
  await save();
  if (state.dirty) return; // the save failed and has said so
  const res = await fetch('/api/editor/patterns', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: node.synced, node }) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Could not update the copies.', 'error'); return; }
  location.reload();
}

function act(what: string) {
  if (!selected) return;
  const node = nodeAt(state.doc, selected);
  if (!node) return;
  const { listPath, index } = splitNodePath(selected);
  const list: Node[] = getAt(state.doc, listPath) ?? [];
  switch (what) {
    case 'parent': { const p = listPath.replace(/\.blocks$/, ''); select(isNodePath(p) ? p : null); return; }
    case 'add': openInserter({ listPath: `${selected}.blocks`, index: node.blocks?.length ?? 0 }); return;
    case 'before': openInserter({ listPath, index }); return;
    case 'after': openInserter({ listPath, index: index + 1 }); return;
    case 'copy': writeClipboard(node); toast(`Copied ${labelOf(node)}.`, 'info'); return;
    case 'paste': paste(); return;
    case 'pattern': savePattern(node); return;
    case 'cut': writeClipboard(node); act('del'); return;
    case 'up': case 'down': {
      const to = index + (what === 'up' ? -1 : 1);
      if (to < 0 || to >= list.length) return;
      const next = moveNode(state.doc, selected, listPath, to);
      selected = `${listPath}.${to}`;
      state.apply(next);
      break;
    }
    case 'dup': {
      const next = insertNode(state.doc, listPath, index + 1, cloneWithNewIds(node));
      selected = `${listPath}.${index + 1}`;
      state.apply(next);
      break;
    }
    case 'del': {
      const next = removeNode(state.doc, selected);
      const parent = listPath.replace(/\.blocks$/, '');
      const remaining: Node[] = getAt(next, listPath) ?? [];
      selected = remaining.length ? `${listPath}.${Math.min(index, remaining.length - 1)}` : (isNodePath(parent) ? parent : null);
      if (!selected) tab = 'page';
      state.apply(next);
      toast(`Deleted ${labelOf(node)}.`, 'info', { action: { label: 'Undo', run: () => state.undo() } });
      break;
    }
  }
  scheduleRender(0);
}
const labelOf = (n: Node) => registry[n.type]?.label ?? n.type;

function setField(fieldPath: string, value: unknown) {
  state.apply(setAt(state.doc, fieldPath, value));
  scheduleRender(0);
}

// ---------- clipboard: works across pages of the site ----------
const CLIP = 'ase:clipboard';
function writeClipboard(n: Node) { try { localStorage.setItem(CLIP, JSON.stringify(n)); } catch { /* private mode */ } }
function readClipboard(): Node | null { try { return JSON.parse(localStorage.getItem(CLIP) ?? 'null'); } catch { return null; } }

/** The nearest place a block of `type` can go: inside the selection, after it, or further out. */
function placeFor(type: string): Target | null {
  if (!selected) return accepts(null, type, registry) ? { listPath: 'sections', index: state.doc.sections.length } : null;
  const node = nodeAt(state.doc, selected)!;
  // A copy of the selected kind of block goes beside it, not inside it.
  if (node.type !== type && accepts(node.type, type, registry)) return { listPath: `${selected}.blocks`, index: node.blocks?.length ?? 0 };
  let path = selected;
  for (;;) {
    const { listPath, index } = splitNodePath(path);
    if (accepts(parentTypeOf(listPath), type, registry)) return { listPath, index: index + 1 };
    if (listPath === 'sections') return null;
    path = listPath.replace(/\.blocks$/, '');
  }
}

function paste() {
  const clip = readClipboard();
  if (!clip) { toast('Nothing copied yet.', 'info'); return; }
  const at = placeFor(clip.type);
  if (!at) { toast(`A ${labelOf(clip)} can't go here.`, 'warn'); return; }
  insertAt(at, cloneWithNewIds(clip));
}

function insertAt(at: Target, node: Node) {
  const next = insertNode(state.doc, at.listPath, at.index, node);
  selected = `${at.listPath}.${at.index}`;
  tab = 'block';
  reveal = selected;
  state.apply(next);
  scheduleRender(0);
}

async function savePattern(node: Node) {
  const toggle = { label: 'Synced: keep every copy linked, so one edit can update them all', on: false };
  const label = await promptDialog({ toggle, title: 'Save as pattern', label: 'Name', value: labelOf(node), submit: 'Save pattern', help: 'Patterns appear in the block inserter on every page. Inserting one makes an independent copy.' });
  if (!label) return;
  const res = await fetch('/api/editor/patterns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label, node, synced: toggle.on }) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Could not save the pattern.', 'error'); return; }
  patterns = data.patterns;
  if (toggle.on) { // the block it came from is the first copy
    const path = pathOfId(state.doc, node.id);
    if (path) { state.apply(replaceNode(state.doc, path, { ...nodeAt(state.doc, path)!, synced: patterns[patterns.length - 1].id })); renderInspector(); }
  }
  toast(`Saved pattern "${label}".`, 'ok');
}

// ---------- inserter ----------
interface Target { listPath: string; index: number }
let target: Target | null = null;
let leftView: 'list' | 'add' | 'off' = 'list';

function setLeft(view: typeof leftView) {
  leftView = view;
  document.body.dataset.left = view;
  $('#ase-toggle-add').classList.toggle('is-active', view === 'add');
  $('#ase-toggle-list').classList.toggle('is-active', view === 'list');
  if (view !== 'add') { target = null; slashBlock = null; placeOverlays(); idoc()?.querySelector('.ase-insertline')?.remove(); }
  fitPreview();
}

function defaultTarget(): Target {
  if (!selected) return { listPath: 'sections', index: state.doc.sections.length };
  const node = nodeAt(state.doc, selected)!;
  if (allowedChildTypes(node.type, registry)?.length) return { listPath: `${selected}.blocks`, index: node.blocks?.length ?? 0 };
  const { listPath, index } = splitNodePath(selected);
  return { listPath, index: index + 1 };
}

function openInserter(at: Target = defaultTarget()) {
  inline.stop(true);
  target = at;
  setLeft('add');
  renderInserterPanel();
  const d = idoc();
  if (!d.querySelector('.ase-insertline')) { const line = d.createElement('div'); line.className = 'ase-insertline'; line.setAttribute('data-ase-ui', ''); d.body.append(line); }
  placeOverlays();
}

function renderInserterPanel() {
  if (!target) return;
  const parent = parentTypeOf(target.listPath);
  renderInserter($('#ase-inserter'), {
    items: () => insertItems(parent, registry, boot.presets, patterns),
    where: () => (parent ? `Adding to ${registry[parent]?.label ?? parent}` : 'Adding to the page'),
    onPick: (item) => pick(item),
    onDeleteSaved: deleteSaved,
    onClose: () => setLeft('list'),
  });
}

function pick(item: InsertItem) {
  if (!target) return;
  const node = item.node ? cloneWithNewIds(item.node) : createNode(item.type!, registry);
  if (item.syncedId) node.synced = item.syncedId;
  const at = target;
  const gone = slashBlock;
  setLeft('list');
  insertAt(at, node);
  if (gone) { // the empty block `/` was typed in gives way to what was picked
    const path = pathOfId(state.doc, gone);
    if (path) { state.apply(removeNode(state.doc, path)); selected = at.listPath + '.' + (at.index - 1); reveal = selected; scheduleRender(0); }
  }
}

/** A block `/` was typed in, if it held nothing: the block picked next replaces it. */
let slashBlock: string | null = null;
function slash(fieldPath: string) {
  const path = nodePathOf(fieldPath);
  const node = nodeAt(state.doc, path);
  if (!node) return;
  const { listPath, index } = splitNodePath(path);
  const blank = !node.blocks?.length && Object.entries(registry[node.type]?.fields ?? {}).every(([k, f]) => !['text', 'textarea', 'richtext'].includes(f.type) || !String(k === nodeField(fieldPath) ? '' : node.settings[k] ?? '').replace(/<[^>]*>/g, '').trim());
  openInserter({ listPath, index: index + 1 });
  slashBlock = blank ? node.id : null;
}
const nodeField = (fieldPath: string) => fieldPath.split('.').pop();

async function deleteSaved(item: InsertItem) {
  if (!await confirmDialog('Delete pattern', `Delete "${item.label}"? Pages already using it keep their copy.`, 'Delete', 'danger')) return;
  const res = await fetch(`/api/editor/patterns?id=${encodeURIComponent(item.savedId!)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Could not delete the pattern.', 'error'); return; }
  patterns = data.patterns;
  renderInserterPanel();
}

// ---------- preview size ----------
const WIDTHS: Record<string, number> = { desktop: 1280, tablet: 1024, mobile: 390 };
let uiScale = 1;

/** Tools drawn inside the preview scale up by the inverse, so they stay a usable size. */
function applyUiScale(scale: number) {
  uiScale = 1 / scale;
  idoc()?.documentElement?.style.setProperty('--ase-ui', String(uiScale));
  placeOverlays();
}

/** The site should show its real layout at every width, so a device wider than the stage scales down. */
function fitPreview() {
  const stage = $('.ase-stage');
  const width = WIDTHS[stage.dataset.device!];
  const room = stage.clientWidth;
  const big = stage.dataset.device === 'desktop' && room >= width;
  const scale = big ? 1 : Math.min(1, room / width);
  iframe.style.width = big ? '100%' : `${width}px`;
  iframe.style.height = scale < 1 ? `${stage.clientHeight / scale}px` : '100%';
  iframe.style.transform = scale < 1 ? `scale(${scale})` : '';
  stage.classList.toggle('is-scaled', scale < 1);
  applyUiScale(scale);
  $('#ase-zoom').textContent = scale < 1 ? `${Math.round(scale * 100)}%` : '';
}
new ResizeObserver(fitPreview).observe($('.ase-stage'));

// ---------- top bar ----------
$('#ase-undo').addEventListener('click', () => { inline.stop(true); state.undo(); });
$('#ase-redo').addEventListener('click', () => { inline.stop(true); state.redo(); });
$('#ase-toggle-add').addEventListener('click', () => { if (leftView === 'add') setLeft('list'); else openInserter(); });
$('#ase-toggle-list').addEventListener('click', () => setLeft(leftView === 'list' ? 'off' : 'list'));
const toggleSettings = () => { const off = document.body.dataset.right !== 'off'; document.body.dataset.right = off ? 'off' : 'on'; $('#ase-toggle-settings').classList.toggle('is-active', !off); fitPreview(); };
$('#ase-toggle-settings').addEventListener('click', toggleSettings);
$('#ase-discard').addEventListener('click', async () => {
  if (!await confirmDialog('Discard changes', 'Discard all unsaved changes to this page?', 'Discard', 'danger')) return;
  const r = await (await fetch(`/api/editor/page/${boot.slug}`)).json();
  renderFull = true;
  state.reset(r.page, r.hash);
});
$('#ase-save').addEventListener('click', () => save());
$('#ase-publish').addEventListener('click', () => publish(true));
$('#ase-preview-tab').addEventListener('click', previewInTab);
document.querySelectorAll<HTMLButtonElement>('.ase-top__devices button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.ase-top__devices button').forEach((x) => x.classList.remove('is-active'));
  b.classList.add('is-active');
  $('.ase-stage').dataset.device = b.dataset.device;
  fitPreview();
}));
$('#ase-more').addEventListener('click', (e) => {
  const items: MenuItem[] = [
    { label: 'Keyboard shortcuts', hint: '?', run: showShortcuts },
    { label: 'Revisions', run: showRevisions },
    { label: 'All pages', run: () => { location.href = '/edit'; }, separator: true },
  ];
  if (boot.options.auth === 'passkey' && boot.options.user) items.push({ label: `Sign out ${boot.options.user}`, run: () => { location.href = '/api/editor/auth/logout'; } });
  openMenu(e.currentTarget as HTMLElement, items);
});

/** The draft, rendered as visitors would see it, in its own tab. */
function previewInTab() {
  inline.stop(true);
  const form = document.createElement('form');
  form.method = 'POST'; form.action = `/edit/preview/${boot.slug}`; form.target = '_blank'; form.hidden = true;
  const input = document.createElement('input'); input.type = 'hidden'; input.name = 'page'; input.value = JSON.stringify(state.doc);
  form.append(input);
  document.body.append(form);
  form.submit();
  form.remove();
}

async function save(opts: { slug?: string } = {}): Promise<{ slug?: string; result?: any } | null> {
  if (!state.dirty && !opts.slug) return null;
  inline.stop(true);
  saving = true; refreshButtons(); setSaveStatus('Saving…');
  try {
    const res = await fetch(`/api/editor/page/${boot.slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: state.doc, base: state.hash, slug: opts.slug }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Save failed', 'error'); setSaveStatus(''); return null; }
    state.markSaved(data.hash);
    boot.page = state.doc;
    const r = data.result;
    if (r.kind === 'github') toast(r.pullRequest ? `Committed and opened a pull request: ${r.pullRequest}` : `Committed ${String(r.commit).slice(0, 7)} to ${r.branch}. The host will rebuild the site.`, 'ok', { href: r.pullRequest || r.url });
    else toast(`Saved to the working tree (${r.files.join(', ')}). Commit it with git when you're happy.`, 'ok');
    setSaveStatus('Saved');
    return data;
  } catch (e: any) { toast(`Save failed: ${e.message}`, 'error'); setSaveStatus(''); return null; }
  finally { saving = false; refreshChrome(); }
}

/** Publish a draft, or take a published page back to draft. Saves straight away, like WordPress. */
async function publish(live: boolean) {
  if (!live && !await confirmDialog('Switch to draft', 'This page will be left out of the site the next time it is built.', 'Switch to draft')) return;
  inline.stop(true);
  const next = structuredClone(state.doc);
  if (live) delete next.status; else next.status = 'draft';
  state.apply(next);
  if (await save()) toast(live ? `${next.title} is published.` : `${next.title} is now a draft.`, 'ok'); else state.undo();
}

async function changeUrl() {
  const existing = boot.pages.map((p) => p.slug).filter((s) => s !== boot.slug);
  const slug = await promptDialog({
    title: 'Change URL', label: 'URL', value: boot.slug, submit: 'Change URL',
    help: boot.options.redirects ? 'Old links will keep working: a redirect is added for you. Links inside other pages are not rewritten.' : 'Old links to this page will stop working, and links inside other pages are not rewritten.',
    check: (v) => (v === boot.slug ? null : slugProblem(v, { existing, reserved: boot.reserved })),
  });
  if (!slug || slug === boot.slug) return;
  const data = await save({ slug });
  if (!data) return;
  if (data.result?.pullRequest) return; // the move is in a pull request; this page stays where it is for now
  leaving = true;
  location.replace(`/edit/${data.slug}`);
}

async function deletePage() {
  if (!await confirmDialog('Delete page', `Delete "${state.doc.title}"? It stays in the site's git history, so it can be recovered by a developer.`, 'Delete page', 'danger')) return;
  const res = await fetch(`/api/editor/page/${boot.slug}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: state.hash }) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Delete failed', 'error'); return; }
  state.clearDraft();
  leaving = true;
  location.href = '/edit';
}

async function showRevisions() {
  const box = document.createElement('div');
  box.innerHTML = '<p class="ase-muted">Loading…</p>';
  const d = dialog('Revisions', box, [{ label: 'Close' }], { wide: true });
  const data = await (await fetch(`/api/editor/page/${boot.slug}?revisions=1`)).json();
  const revs = (data.revisions ?? []) as Revision[];
  box.innerHTML = '';
  if (!revs.length) { box.innerHTML = '<p class="ase-muted">No revisions yet. Each committed save appears here.</p>'; return; }
  const ul = document.createElement('ul'); ul.className = 'ase-revisions';
  for (const r of revs) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const when = document.createElement('strong'); when.textContent = new Date(r.date).toLocaleString();
    const what = document.createElement('span'); what.className = 'ase-muted ase-ellipsis'; what.textContent = `${r.author} · ${r.message}`;
    info.append(when, what);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ase-btn ase-btn--small'; b.textContent = 'Restore';
    b.addEventListener('click', async () => {
      const res = await (await fetch(`/api/editor/page/${boot.slug}?rev=${r.sha}`)).json();
      if (!res.page) { toast('That revision could not be loaded.', 'error'); return; }
      d.close();
      inline.stop(true);
      selected = null; tab = 'page';
      renderFull = true;
      const { status, ...rest } = res.page as PageDoc; // restoring content never publishes or unpublishes
      state.apply({ ...rest, ...(state.doc.status ? { status: state.doc.status } : {}) }, 'restore');
      toast('Revision loaded. Save to keep it.', 'info', { action: { label: 'Undo', run: () => state.undo() } });
    });
    li.append(info, b);
    ul.append(li);
  }
  box.append(ul);
}

function showShortcuts() {
  const groups: [string, [string, string][]][] = [
    ['Page', [['⌘S', 'Save'], ['⌘Z', 'Undo'], ['⇧⌘Z', 'Redo'], ['/', 'Add a block'], ['⇧⌘,', 'Show or hide settings'], ['⌃⌥O', 'Show or hide List View'], ['?', 'This list']]],
    ['Selected block', [['↑ ↓', 'Select previous / next block'], ['Esc', 'Deselect'], ['⇧⌘D', 'Duplicate'], ['Del', 'Delete'], ['⌘C ⌘X ⌘V', 'Copy, cut, paste'], ['⌥⌘T', 'Add before'], ['⌥⌘Y', 'Add after'], ['⇧⌥⌘T', 'Move up'], ['⇧⌥⌘Y', 'Move down']]],
    ['Text', [['⌘B', 'Bold'], ['⌘I', 'Italic'], ['⌘U', 'Underline'], ['⌘K', 'Link'], ['Esc', 'Cancel the edit']]],
  ];
  const box = document.createElement('div');
  box.className = 'ase-keys';
  for (const [title, rows] of groups) {
    const h = document.createElement('h3'); h.textContent = title;
    const dl = document.createElement('dl');
    for (const [k, what] of rows) { const dt = document.createElement('dt'); dt.textContent = what; const dd = document.createElement('dd'); dd.innerHTML = k.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' '); dl.append(dt, dd); }
    box.append(h, dl);
  }
  dialog('Keyboard shortcuts', box, [{ label: 'Close' }], { wide: true });
}

/** The block before or after the selected one, in page order. */
function neighbour(step: 1 | -1): string | null {
  const all = Array.from(idoc().querySelectorAll<HTMLElement>('[data-ase-node]')).map((e) => e.dataset.aseNode!);
  if (!selected) return all[0] ?? null;
  return all[all.indexOf(selected) + step] ?? null;
}

function onKeydown(e: KeyboardEvent) {
  const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  const run = (fn: () => void) => { e.preventDefault(); fn(); };
  if (mod && key === 's') return run(() => { save(); });
  if (mod && e.shiftKey && (key === ',' || key === '<')) return run(toggleSettings);
  if (e.ctrlKey && e.altKey && (key === 'o' || e.code === 'KeyO')) return run(() => setLeft(leftView === 'list' ? 'off' : 'list'));
  if (typing) return;
  if (document.querySelector('.ase-modal')) return;
  if (mod && key === 'z') return run(() => (e.shiftKey ? state.redo() : state.undo()));
  if (mod && key === 'c' && selected && !idoc().getSelection()?.toString() && !getSelection()?.toString()) return run(() => act('copy'));
  if (mod && key === 'x' && selected) return run(() => act('cut'));
  if (mod && key === 'v') return run(paste);
  if (mod && e.altKey && e.code === 'KeyT') return run(() => act(e.shiftKey ? 'up' : 'before'));
  if (mod && e.altKey && e.code === 'KeyY') return run(() => act(e.shiftKey ? 'down' : 'after'));
  if (mod && e.shiftKey && key === 'd') return run(() => act('dup'));
  if (mod || e.altKey) return;
  if (e.key === '/') return run(() => openInserter());
  if (e.key === '?') return run(showShortcuts);
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) return run(() => act('del'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const to = neighbour(e.key === 'ArrowDown' ? 1 : -1); if (to) run(() => select(to)); return; }
  if (e.key === 'Escape') { if (leftView === 'add') setLeft('list'); else select(null); }
}
document.addEventListener('keydown', onKeydown);
window.addEventListener('beforeunload', (e) => { if (state.dirty && !leaving) e.preventDefault(); });

// ---------- state → UI ----------
state.addEventListener('change', (e) => {
  const source = (e as CustomEvent).detail.source;
  if (source === 'inline') return; // DOM already matches; chrome refreshes on commit
  if (source === 'field') { refreshChrome({ inspector: false }); return; } // the sidebar is the source: leave the focused input alone
  if (source === 'undo' || source === 'redo' || source === 'restore' || source === 'reset') {
    inline.stop(false);
    if (selected && !nodeAt(state.doc, selected)) { selected = null; tab = 'page'; }
    renderFull = true;
    scheduleRender(0);
  }
  refreshChrome();
});

function setSaveStatus(t: string) { $('#ase-status').textContent = t; }

// Top-bar buttons get their icons here, so the Astro shell stays plain markup.
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon as keyof typeof icons]); });
document.body.dataset.left = 'list';
fitPreview();
refreshChrome();
// A light page can finish loading before this module runs, and then `load` never fires for us.
if (idoc()?.readyState === 'complete' && idoc().location.href !== 'about:blank') onPreviewLoad();
else iframe.addEventListener('load', onPreviewLoad);
