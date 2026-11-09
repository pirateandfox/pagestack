// One Markdown item: frontmatter form, Markdown body, live preview.
import { marked } from 'marked';
import type { Field } from '../runtime';
import { sanitizeHtml } from '../core/sanitize';
import { renderForm } from './form';
import { pickImage } from './picker';
import { promptDialog, toast } from './ui';
import { InlineEditor } from './inline';
import { blockAt, replaceBlock } from '../core/markdown';
import { blockToMarkdown } from './tomarkdown';
import previewCss from './preview.css?raw';

interface Boot { id: string; slug: string; singular: string; fields: Record<string, Field>; data: Record<string, any>; body: string; hash: string; viewUrl: string | null; preview: boolean; pages: { title: string; url: string }[] }
const boot = (window as any).__ASE_ITEM__ as Boot;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = $<HTMLInputElement>('ase-item-title');
const body = $<HTMLTextAreaElement>('ase-item-body');
const preview = $('ase-item-preview');
const saveBtn = $<HTMLButtonElement>('ase-item-save');
const publishBtn = $<HTMLButtonElement>('ase-item-publish');
const draftBtn = $<HTMLButtonElement>('ase-item-draft');
const status = $('ase-item-status');

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
  const view = document.getElementById('ase-item-view'); if (view) view.hidden = draft;
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
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.textContent = text; b.className = 'ase-btn ase-btn--small ase-btn--ghost';
  b.addEventListener('click', run);
  $('ase-mdbar').append(b);
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
  toast(d.unchanged ? 'No changes to save.' : d.result?.pullRequest ? 'Saved as a pull request.' : d.result?.kind === 'github' ? 'Saved. The site will rebuild.' : 'Saved.', 'ok');
  return true;
}
saveBtn.addEventListener('click', save);
const setDraft = async (v: boolean) => { const was = data.draft; data.draft = v; if (!await save()) { data.draft = was; chrome(); } };
publishBtn.addEventListener('click', () => setDraft(false));
draftBtn.addEventListener('click', () => setDraft(true));
addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); } });
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ---- start ----
title.value = data.title ?? '';
title.addEventListener('input', () => { data.title = title.value; touch(); schedulePage(); });
body.value = boot.body;
const { title: _, draft: __, ...side } = boot.fields;
const drawForm = () => renderForm($('ase-item-form'), { label: boot.singular, fields: side }, data, { pickImage, pageUrls: boot.pages, onChange: (name, value) => { data[name] = value; touch(); schedulePage(); } });
drawForm();
draw(); chrome();

// ---- page mode: the item on its own layout, edited in place ----
// The site's `previews` component renders it; body blocks carry data-ase-md="<index>", and an
// edited paragraph or heading is turned back into Markdown and replaces only its own source.
const frame = document.getElementById('ase-item-frame') as HTMLIFrameElement | null;
const pageBox = document.getElementById('ase-item-page');
const previewUrl = `/edit/preview-item/${boot.id}/${boot.slug}`;
let mode: 'page' | 'markdown' = 'markdown';
let frameReady = false;
let pageTimer: ReturnType<typeof setTimeout> | undefined;
let pageSeq = 0;
let pageQueued = false;
let editingBlock: { el: HTMLElement; index: number; depth?: number } | null = null;
const fdoc = () => frame!.contentDocument!;

function setMode(m: 'page' | 'markdown') {
  if (!frame) return;
  if (inline.isActive) inline.stop(true);
  mode = m;
  pageBox!.hidden = m !== 'page';
  $('ase-item-md').hidden = m === 'page';
  document.querySelectorAll<HTMLElement>('.ase-seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  try { localStorage.setItem('ase-item-mode', m); } catch { /* private mode */ }
  if (m === 'page') { if (!frame.src) frame.src = previewUrl; else if (frameReady) renderPage(); }
}
function schedulePage(ms = 300) { if (frame && mode === 'page') { clearTimeout(pageTimer); pageTimer = setTimeout(renderPage, ms); } }

async function renderPage() {
  if (!frameReady) return;
  if (inline.isActive) { pageQueued = true; return; } // never swap the text under the cursor
  const seq = ++pageSeq;
  const res = await fetch(previewUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, body: body.value }) }).catch(() => null);
  if (!res || seq !== pageSeq) return;
  const html = await res.text();
  if (!res.ok) { toast(`Preview failed: ${html.slice(0, 160)}`, 'error'); return; }
  if (inline.isActive) { pageQueued = true; return; }
  const fresh = new DOMParser().parseFromString(html, 'text/html');
  const win = frame!.contentWindow!; const y = win.scrollY;
  fdoc().body.innerHTML = fresh.body.innerHTML;
  fdoc().body.className = fresh.body.className;
  win.scrollTo(0, y);
}

const inline = new InlineEditor({
  pages: boot.pages,
  onStart: () => {},
  onInput: () => {},
  onCommit: (path, value, didChange) => {
    const blk = editingBlock; editingBlock = null;
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
  if (t.closest('.ase-rt, .ase-link, [data-ase-ui]')) return;
  if (!t.closest('summary')) e.preventDefault(); // links don't navigate while editing
  const field = t.closest<HTMLElement>('[data-ase-field]');
  const blockEl = t.closest<HTMLElement>('[data-ase-md]');
  if (field && !field.dataset.aseField!.startsWith('md:')) {
    const name = field.dataset.aseField!;
    if (field.dataset.aseFieldType === 'image') {
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
    const index = Number(blockEl.dataset.aseMd);
    const kind = blockEl.dataset.aseMdKind;
    if (kind === 'text') {
      if (editingBlock?.el === blockEl) return;
      if (inline.isActive) inline.stop(true);
      const src = blockAt(body.value, index);
      editingBlock = { el: blockEl, index, depth: src?.type === 'heading' ? src.depth : undefined };
      blockEl.dataset.aseField = `md:${index}`; blockEl.dataset.aseFieldType = 'richtext';
      inline.start(blockEl);
      return;
    }
    if (inline.isActive) inline.stop(true);
    if (kind === 'image') {
      const m = blockAt(body.value, index)?.raw.match(/!\[([^\]]*)\]\(([^)\s]+)/);
      pickImage(m ? { src: m[2], alt: m[1] } : undefined, (img) => { body.value = replaceBlock(body.value, index, `![${img.alt.replace(/[[\]]/g, '')}](${img.src})`); changed(); });
      return;
    }
    // Lists, tables, code: edit their Markdown, with the block selected.
    const b = blockAt(body.value, index);
    setMode('markdown');
    if (b) { body.focus(); body.setSelectionRange(b.start, b.start + b.raw.trimEnd().length); }
    return;
  }
  if (inline.isActive) inline.stop(true);
}

if (frame) {
  frame.addEventListener('load', () => {
    const d = fdoc();
    const style = d.createElement('style'); style.textContent = previewCss + '[data-ase-md]{cursor:text}[data-ase-md]:hover{outline:1px dotted #2563eb;outline-offset:2px}[data-ase-md-kind="block"],[data-ase-md-kind="image"]{cursor:pointer}';
    d.head.append(style);
    d.addEventListener('click', onFrameClick, true);
    d.addEventListener('submit', (e) => e.preventDefault(), true);
    d.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (inline.isActive) inline.stop(true); if (dirty) save(); } });
    frameReady = true;
    if (dirty) renderPage();
  });
  document.querySelectorAll<HTMLElement>('.ase-seg__btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as 'page' | 'markdown')));
  let saved: string | null = null;
  try { saved = localStorage.getItem('ase-item-mode'); } catch { /* private mode */ }
  setMode(saved === 'markdown' ? 'markdown' : 'page');
  // A look at the unsaved item as visitors will see it, in its own tab.
  document.getElementById('ase-item-tab')?.addEventListener('click', () => {
    if (inline.isActive) inline.stop(true);
    const form = document.createElement('form');
    form.method = 'POST'; form.action = previewUrl; form.target = '_blank'; form.hidden = true;
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'item'; input.value = JSON.stringify({ data, body: body.value });
    form.append(input); document.body.append(form); form.submit(); form.remove();
  });
}
