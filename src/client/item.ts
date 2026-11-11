// One Markdown item: frontmatter form, Markdown body, live preview.
import { marked } from 'marked';
import type { Field } from '../runtime';
import { sanitizeHtml } from '../core/sanitize';
import { renderForm } from './form';
import { pickImage } from './picker';
import { confirmDialog, dialog, openMenu, promptDialog, toast } from './ui';
import { icons } from './icons';
import { InlineEditor } from './inline';
import { NEW_BLOCKS, blockAt, insertBlock, replaceBlock } from '../core/markdown';
import { blockToMarkdown } from './tomarkdown';
import previewCss from './preview.css?raw';

interface Boot { id: string; slug: string; singular: string; fields: Record<string, Field>; data: Record<string, any>; body: string; hash: string; viewUrl: string | null; redirects: boolean; preview: boolean; pages: { title: string; url: string }[] }
const boot = (window as any).__PS_ITEM__ as Boot;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = $<HTMLInputElement>('ps-item-title');
const body = $<HTMLTextAreaElement>('ps-item-body');
const preview = $('ps-item-preview');
const saveBtn = $<HTMLButtonElement>('ps-item-save');
const publishBtn = $<HTMLButtonElement>('ps-item-publish');
const draftBtn = $<HTMLButtonElement>('ps-item-draft');
const status = $('ps-item-status');

const data = structuredClone(boot.data);
const hasDraft = boot.fields.draft?.type === 'boolean';
let hash = boot.hash;
let dirty = false;

function chrome() {
  const draft = hasDraft && data.draft === true;
  saveBtn.textContent = !hasDraft ? 'Save' : draft ? 'Save draft' : 'Update';
  publishBtn.hidden = !draft;
  draftBtn.hidden = !hasDraft || draft;
  saveBtn.disabled = !dirty;
  const view = document.getElementById('ps-item-view'); if (view) view.hidden = draft;
  status.textContent = dirty ? 'Unsaved changes' : draft ? 'Draft: not on the site yet' : '';
}
const touch = () => { dirty = true; chrome(); };

function draw() { preview.innerHTML = sanitizeHtml(marked.parse(body.value, { async: false }) as string); }

// ---- formatting ----
function wrap(before: string, after = before, placeholder = 'text') {
  const { selectionStart: a, selectionEnd: b, value } = body;
  const inner = value.slice(a, b) || placeholder;
  body.setRangeText(before + inner + after, a, b, 'end');
  body.setSelectionRange(a + before.length, a + before.length + inner.length);
  changed();
}
function line(prefix: string) {
  const { selectionStart: a, selectionEnd: b, value } = body;
  const start = value.lastIndexOf('\n', a - 1) + 1;
  const end = b + (value.slice(b).indexOf('\n') + 1 || value.length - b + 1) - 1;
  const lines = value.slice(start, end).split('\n').map((l) => prefix + l.replace(/^(#{1,6} |> |- |\d+\. )/, ''));
  body.setRangeText(lines.join('\n'), start, end, 'end');
  changed();
}
async function link() {
  const { selectionStart: a, selectionEnd: b } = body;
  const url = await promptDialog({ title: 'Add link', label: 'URL', value: 'https://', submit: 'Add link' });
  if (!url) return;
  body.focus(); body.setSelectionRange(a, b);
  wrap('[', `](${url})`, 'link text');
}
function image() {
  const at = body.selectionStart;
  pickImage(undefined, (img) => { body.focus(); body.setRangeText(`\n\n![${img.alt}](${img.src})\n\n`, at, at, 'end'); changed(); });
}
const tools: [string, string, () => void][] = [
  ['Heading', 'H2', () => line('## ')], ['Subheading', 'H3', () => line('### ')],
  ['Bold (⌘B)', 'B', () => wrap('**')], ['Italic (⌘I)', 'I', () => wrap('*')], ['Link (⌘K)', 'Link', link],
  ['Bulleted list', 'List', () => line('- ')], ['Quote', 'Quote', () => line('> ')], ['Image', 'Image', image],
];
for (const [label, text, run] of tools) {
  const b = document.createElement('button');
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.textContent = text; b.className = 'ps-btn ps-btn--small ps-btn--ghost';
  b.addEventListener('click', run);
  $('ps-mdbar').append(b);
}
function changed() { draw(); touch(); schedulePage(); }
body.addEventListener('input', changed);
body.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); wrap('**'); } else if (k === 'i') { e.preventDefault(); wrap('*'); } else if (k === 'k') { e.preventDefault(); link(); }
});

// ---- saving ----
async function save(): Promise<boolean> {
  if (frame && inline.isActive) inline.stop(true);
  saveBtn.disabled = true; status.textContent = 'Saving…';
  const res = await fetch(`/api/editor/collection/${boot.id}/${boot.slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, body: body.value, base: hash }) });
  const d = await res.json();
  if (!res.ok) { toast(d.error || 'Save failed', 'error'); saveBtn.disabled = false; status.textContent = 'Not saved'; return false; }
  hash = d.hash; dirty = false; chrome();
  toast(d.unchanged ? 'No changes to save.' : d.result?.pullRequest ? 'Saved as a pull request.' : d.result?.kind === 'github' ? (document.getElementById('ps-live') ? 'Saved. Use Go live to put it on the site.' : 'Saved. The site will rebuild.') : 'Saved.', 'ok');
  return true;
}
saveBtn.addEventListener('click', save);
const setDraft = async (v: boolean) => { const was = data.draft; data.draft = v; if (!await save()) { data.draft = was; chrome(); } };
publishBtn.addEventListener('click', () => setDraft(false));
draftBtn.addEventListener('click', () => setDraft(true));
addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } });
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ---- URL, revisions, delete ----
const moreBtn = $<HTMLButtonElement>('ps-item-more');
moreBtn.innerHTML = icons.more;
moreBtn.addEventListener('click', () => openMenu(moreBtn, [
  { label: 'Change URL', run: changeUrl },
  { label: 'Revisions', run: showRevisions },
  { label: `Delete ${boot.singular}`, run: deleteItem, danger: true },
]));

async function changeUrl() {
  const next = await promptDialog({
    title: 'Change URL', label: 'URL', value: boot.slug, submit: 'Change URL',
    help: boot.redirects ? 'Old links keep working: a redirect is added for you. Links inside other pages are not rewritten.' : 'Old links to it will stop working, and links inside other pages are not rewritten.',
    check: (v) => (v === boot.slug || /^[a-z0-9][a-z0-9_-]*$/.test(v) ? null : 'Use lowercase letters, numbers and dashes.'),
  });
  if (!next || next === boot.slug) return;
  if (frame && inline.isActive) inline.stop(true);
  const res = await fetch(`/api/editor/collection/${boot.id}/${boot.slug}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, body: body.value, base: hash, slug: next }) });
  const d = await res.json();
  if (!res.ok) { toast(d.error || 'Could not change the URL.', 'error'); return; }
  if (d.result?.pullRequest) { toast('The move is in a pull request; this stays where it is until that is merged.', 'info', { href: d.result.pullRequest }); return; }
  dirty = false;
  location.replace(`/edit/collection/${boot.id}/${d.slug}`);
}

async function showRevisions() {
  const box = document.createElement('div');
  box.innerHTML = '<p class="ps-muted">Loading…</p>';
  const dlg = dialog('Revisions', box, [{ label: 'Close' }], { wide: true });
  const res = await (await fetch(`/api/editor/collection/${boot.id}/${boot.slug}?revisions=1`)).json();
  const revs = (res.revisions ?? []) as { sha: string; message: string; author: string; date: string }[];
  box.innerHTML = '';
  if (!revs.length) { box.innerHTML = '<p class="ps-muted">No revisions yet. Each committed save appears here.</p>'; return; }
  const ul = document.createElement('ul'); ul.className = 'ps-revisions';
  for (const r of revs) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const when = document.createElement('strong'); when.textContent = new Date(r.date).toLocaleString();
    const what = document.createElement('span'); what.className = 'ps-muted ps-ellipsis'; what.textContent = `${r.author} · ${r.message}`;
    info.append(when, what);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ps-btn ps-btn--small'; b.textContent = 'Restore';
    b.addEventListener('click', async () => {
      const old = await (await fetch(`/api/editor/collection/${boot.id}/${boot.slug}?rev=${r.sha}`)).json();
      if (!old?.data) { toast('That revision could not be loaded.', 'error'); return; }
      dlg.close();
      if (frame && inline.isActive) inline.stop(false);
      const draft = data.draft; // restoring content never publishes or unpublishes
      for (const k of Object.keys(data)) delete data[k];
      Object.assign(data, old.data);
      if (hasDraft) data.draft = draft; else delete data.draft;
      title.value = data.title ?? '';
      body.value = old.body ?? '';
      drawForm(); changed(); chrome();
      toast('Revision loaded. Save to keep it.', 'info');
    });
    li.append(info, b); ul.append(li);
  }
  box.append(ul);
}

async function deleteItem() {
  if (!await confirmDialog(`Delete ${boot.singular}`, `Delete "${data.title ?? boot.slug}"? It stays in the site's git history, so it can be recovered by a developer.`, 'Delete', 'danger')) return;
  const res = await fetch(`/api/editor/collection/${boot.id}/${boot.slug}`, { method: 'DELETE' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { toast(d.error || 'Delete failed', 'error'); return; }
  dirty = false;
  location.href = `/edit/collection/${boot.id}`;
}

// ---- start ----
title.value = data.title ?? '';
title.addEventListener('input', () => { data.title = title.value; touch(); schedulePage(); });
body.value = boot.body;
const { title: _, draft: __, ...side } = boot.fields;
const drawForm = () => renderForm($('ps-item-form'), { label: boot.singular, fields: side }, data, { pickImage, pageUrls: boot.pages, onChange: (name, value) => { data[name] = value; touch(); schedulePage(); } });
drawForm();
draw(); chrome();

// ---- page mode: the item on its own layout, edited in place ----
// The site's `previews` component renders it; body blocks carry data-ps-md="<index>", and an
// edited paragraph or heading is turned back into Markdown and replaces only its own source.
const frame = document.getElementById('ps-item-frame') as HTMLIFrameElement | null;
const pageBox = document.getElementById('ps-item-page');
const previewUrl = `/edit/preview-item/${boot.id}/${boot.slug}`;
let mode: 'page' | 'markdown' = 'markdown';
let frameReady = false;
let pageTimer: ReturnType<typeof setTimeout> | undefined;
let pageSeq = 0;
let pageQueued = false;
let editingBlock: { el: HTMLElement; index: number; depth?: number; undo?: { body: string; dirty: boolean } } | null = null;
const fdoc = () => frame!.contentDocument!;

function setMode(m: 'page' | 'markdown') {
  if (!frame) return;
  if (inline.isActive) inline.stop(true);
  mode = m;
  pageBox!.hidden = m !== 'page';
  $('ps-item-md').hidden = m === 'page';
  document.querySelectorAll<HTMLElement>('.ps-seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  try { localStorage.setItem('ps-item-mode', m); } catch { /* private mode */ }
  if (m === 'page') { if (!frame.src) frame.src = previewUrl; else if (frameReady) renderPage(); }
}
function schedulePage(ms = 300) { if (frame && mode === 'page') { clearTimeout(pageTimer); pageTimer = setTimeout(renderPage, ms); } }

async function renderPage(): Promise<boolean> {
  if (!frameReady) return false;
  if (inline.isActive) { pageQueued = true; return false; } // never swap the text under the cursor
  const seq = ++pageSeq;
  const res = await fetch(previewUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, body: body.value }) }).catch(() => null);
  if (!res || seq !== pageSeq) return false;
  const html = await res.text();
  if (!res.ok) { toast(`Preview failed: ${html.slice(0, 160)}`, 'error'); return false; }
  if (inline.isActive) { pageQueued = true; return false; }
  const fresh = new DOMParser().parseFromString(html, 'text/html');
  const win = frame!.contentWindow!; const y = win.scrollY;
  fdoc().body.innerHTML = fresh.body.innerHTML;
  fdoc().body.className = fresh.body.className;
  win.scrollTo(0, y);
  return true;
}

const inline = new InlineEditor({
  pages: boot.pages,
  onStart: () => {},
  onInput: () => {},
  onSlash: () => {
    // "/" in an emptied block: the new block takes its place. Stop editing first, without saving
    // the emptied text, so the menu taking focus can't commit it.
    const blk = editingBlock; if (!blk) return;
    const undo = blk.undo ?? { body: body.value, dirty };
    editingBlock = null; inline.stop(false);
    const base = removeAt(body.value, blk.index);
    openInserter(blk.el, base, prevIndex(base, blk.index), undo);
  },
  onCommit: (path, value, didChange) => {
    const blk = editingBlock; editingBlock = null;
    if (blk?.undo && !didChange) {
      // A block just added and left as it came: take it out again.
      body.value = blk.undo.body; dirty = blk.undo.dirty; draw(); chrome(); schedulePage(0);
      return;
    }
    if (didChange) {
      if (blk) {
        const md = blockToMarkdown(blk.el, blk.depth);
        body.value = md ? replaceBlock(body.value, blk.index, md) : removeBlock(body.value, blk.index);
      } else {
        data[path] = value;
        if (path === 'title') title.value = value;
        else drawForm();
      }
      draw(); touch();
    }
    if (didChange || pageQueued) { pageQueued = false; schedulePage(0); }
  },
});
const removeBlock = (md: string, i: number) => { const b = blockAt(md, i); return b ? md.slice(0, b.start) + md.slice(b.end) : md; };

function onFrameClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('.ps-rt, .ps-link, [data-ps-ui]')) return;
  if (!t.closest('summary')) e.preventDefault(); // links don't navigate while editing
  const field = t.closest<HTMLElement>('[data-ps-field]');
  const blockEl = t.closest<HTMLElement>('[data-ps-md]');
  if (field && !field.dataset.psField!.startsWith('md:')) {
    const name = field.dataset.psField!;
    if (field.dataset.psFieldType === 'image') {
      const f = boot.fields[name];
      const cur = data[name];
      pickImage(cur ? (typeof cur === 'string' ? { src: cur, alt: f?.altField ? data[f.altField] ?? '' : '' } : cur) : undefined, (img) => {
        data[name] = f?.asUrl ? img.src : img;
        if (f?.asUrl && f.altField) data[f.altField] = img.alt;
        drawForm(); touch(); schedulePage(0);
      });
      return;
    }
    if (inline.activePath !== name) inline.start(field);
    return;
  }
  if (blockEl) {
    const index = Number(blockEl.dataset.psMd);
    const kind = blockEl.dataset.psMdKind;
    if (kind === 'text') { if (editingBlock?.el !== blockEl) editBlock(blockEl, index); return; }
    if (inline.isActive) inline.stop(true);
    if (kind === 'image') {
      const m = blockAt(body.value, index)?.raw.match(/!\[([^\]]*)\]\(([^)\s]+)/);
      pickImage(m ? { src: m[2], alt: m[1] } : undefined, (img) => { body.value = replaceBlock(body.value, index, `![${img.alt.replace(/[[\]]/g, '')}](${img.src})`); changed(); });
      return;
    }
    markdownAt(index); // tables, code, nested lists: edit their Markdown, with the block selected
    return;
  }
  if (inline.isActive) inline.stop(true);
}

function editBlock(el: HTMLElement, index: number, undo?: { body: string; dirty: boolean }) {
  if (inline.isActive) inline.stop(true);
  const src = blockAt(body.value, index);
  editingBlock = { el, index, depth: src?.type === 'heading' ? src.depth : undefined, undo };
  el.dataset.psField = `md:${index}`; el.dataset.psFieldType = 'richtext';
  inline.start(el);
  if (undo) { // a new block: its sample text is selected, so typing replaces it
    const target = el.querySelector('li, p') ?? el;
    const r = fdoc().createRange(); r.selectNodeContents(target);
    const sel = fdoc().getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
  }
}

function markdownAt(index: number) {
  const b = blockAt(body.value, index);
  setMode('markdown');
  if (b) { body.focus(); body.setSelectionRange(b.start, b.start + b.raw.trimEnd().length); }
}

// ---- adding blocks on the page: a + beside the block under the pointer, or / in an empty one ----
const ADD: { label: string; hint?: string; key: keyof typeof NEW_BLOCKS | 'image' }[] = [
  { label: 'Paragraph', key: 'paragraph' }, { label: 'Heading', key: 'heading' }, { label: 'Subheading', key: 'subheading' },
  { label: 'Bulleted list', key: 'list' }, { label: 'Numbered list', key: 'numbered' }, { label: 'Quote', key: 'quote' },
  { label: 'Image', key: 'image' }, { label: 'Table', hint: 'in Markdown', key: 'table' },
];
let plus: HTMLButtonElement | null = null;
let plusFor: { el: HTMLElement; index: number } | null = null;

function placePlus(e: MouseEvent) {
  if (!plus || inline.isActive) return;
  const t = e.target as HTMLElement;
  if (t === plus) return;
  const blk = t.closest<HTMLElement>('[data-ps-md]');
  if (!blk) return;
  const r = blk.getBoundingClientRect();
  plusFor = { el: blk, index: Number(blk.dataset.psMd) };
  plus.style.top = `${r.bottom}px`;
  plus.style.left = `${Math.max(16, r.left - 18)}px`;
  plus.hidden = false;
}

function openInserter(anchor: HTMLElement, base: string, at: number | null, undo: { body: string; dirty: boolean }) {
  openMenu(anchor, ADD.map((a) => ({ label: a.label, hint: a.hint, run: () => addBlock(a.key, base, at, undo) })));
}

async function addBlock(key: (typeof ADD)[number]['key'], base: string, at: number | null, undo: { body: string; dirty: boolean }) {
  if (inline.isActive) inline.stop(true);
  if (key === 'image') {
    pickImage(undefined, (img) => { body.value = insertBlock(base, at, `![${img.alt.replace(/[[\]]/g, '')}](${img.src})`).md; changed(); });
    return;
  }
  const { md, index } = insertBlock(base, at, NEW_BLOCKS[key]);
  body.value = md; draw(); touch();
  if (key === 'table') { markdownAt(index); return; }
  if (!await renderPage()) return;
  const el = fdoc().querySelector<HTMLElement>(`[data-ps-md="${index}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest' });
  editBlock(el, index, undo);
}
const removeAt = (md: string, i: number) => { const b = blockAt(md, i); return b ? (md.slice(0, b.start) + md.slice(b.end)) : md; };
/** The block before position `i` once block `i` is gone, as an index into `md`. */
function prevIndex(md: string, i: number): number | null {
  for (let j = i - 1; j >= 0; j--) { const b = blockAt(md, j); if (b && b.type !== 'space') return j; }
  return null;
}

if (frame) {
  frame.addEventListener('load', () => {
    const d = fdoc();
    const style = d.createElement('style'); style.textContent = previewCss + '[data-ps-md]{cursor:text}[data-ps-md]:hover{outline:1px dotted #2563eb;outline-offset:2px}[data-ps-md-kind="block"],[data-ps-md-kind="image"]{cursor:pointer}';
    d.head.append(style);
    d.addEventListener('click', onFrameClick, true);
    d.addEventListener('submit', (e) => e.preventDefault(), true);
    plus = d.createElement('button');
    plus.type = 'button'; plus.className = 'ps-plus'; plus.setAttribute('data-ps-ui', ''); plus.hidden = true;
    plus.title = 'Add a block'; plus.setAttribute('aria-label', 'Add a block'); plus.innerHTML = icons.plus;
    plus.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (plusFor) openInserter(plus!, body.value, plusFor.index, { body: body.value, dirty }); });
    d.documentElement.append(plus);
    d.addEventListener('mousemove', placePlus);
    d.defaultView?.addEventListener('scroll', () => { if (plus) plus.hidden = true; });
    d.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (inline.isActive) inline.stop(true); if (dirty) save(); } });
    frameReady = true;
    if (dirty) renderPage();
  });
  document.querySelectorAll<HTMLElement>('.ps-seg__btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'page' | 'markdown')));
  let saved: string | null = null;
  try { saved = localStorage.getItem('ps-item-mode'); } catch { /* private mode */ }
  setMode(saved === 'markdown' ? 'markdown' : 'page');
  // A look at the unsaved item as visitors will see it, in its own tab.
  document.getElementById('ps-item-tab')?.addEventListener('click', () => {
    if (inline.isActive) inline.stop(true);
    const form = document.createElement('form');
    form.method = 'POST'; form.action = previewUrl; form.target = '_blank'; form.hidden = true;
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'item'; input.value = JSON.stringify({ data, body: body.value });
    form.append(input); document.body.append(form); form.submit(); form.remove();
  });
}
