// One Markdown item: frontmatter form, Markdown body, live preview.
import { marked } from 'marked';
import type { Field } from '../runtime';
import { sanitizeHtml } from '../core/sanitize';
import { renderForm } from './form';
import { pickImage } from './picker';
import { promptDialog, toast } from './ui';

interface Boot { id: string; slug: string; singular: string; fields: Record<string, Field>; data: Record<string, any>; body: string; hash: string; viewUrl: string | null; pages: { title: string; url: string }[] }
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
function changed() { draw(); touch(); }
body.addEventListener('input', changed);
body.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); wrap('**'); } else if (k === 'i') { e.preventDefault(); wrap('*'); } else if (k === 'k') { e.preventDefault(); link(); }
});

// ---- saving ----
async function save(): Promise<boolean> {
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
title.addEventListener('input', () => { data.title = title.value; touch(); });
body.value = boot.body;
const { title: _, draft: __, ...side } = boot.fields;
renderForm($('ase-item-form'), { label: boot.singular, fields: side }, data, { pickImage, pageUrls: boot.pages, onChange: (name, value) => { data[name] = value; touch(); } });
draw(); chrome();
