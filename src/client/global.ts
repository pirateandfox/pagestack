// Edit a site-wide document with the same form widgets as the block sidebar.
import type { Field } from '../runtime';
import { renderForm } from './form';
import { pickImage } from './picker';
import { toast } from './ui';

interface Boot { id: string; label: string; fields: Record<string, Field>; pages: { title: string; url: string }[] }
const boot = (window as any).__ASE_GLOBAL__ as Boot;
const root = document.getElementById('ase-global-form')!;
const saveBtn = document.getElementById('ase-global-save') as HTMLButtonElement;
const url = `/api/editor/global/${boot.id}`;
let doc: Record<string, unknown> = {};
let hash: string | null = null;
let dirty = false;

const res = await fetch(url);
const data = await res.json();
doc = data.doc; hash = data.hash;
renderForm(root, { label: boot.label, fields: boot.fields }, doc, {
  pickImage,
  pageUrls: boot.pages,
  onChange: (name, value) => { doc[name] = value; dirty = true; saveBtn.disabled = false; },
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, base: hash }) });
  const d = await r.json();
  if (!r.ok) { toast(d.error || 'Save failed', 'error'); saveBtn.disabled = false; return; }
  hash = d.hash; dirty = false;
  toast(d.result.kind === 'github' ? 'Saved. The site will rebuild.' : "Saved to the working tree. Commit it with git when you're happy.", 'ok');
});
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
