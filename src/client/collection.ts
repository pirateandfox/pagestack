// The list of a collection: add, delete, search.
import { slugify, uniqueSlug } from '../core/pages';
import { missingFields } from '../core/required';
import type { Field } from '../runtime';
import { renderForm, showMissing } from './form';
import { pickImage } from './picker';
import { confirmDialog, dialog, promptDialog, toast } from './ui';

const boot = (window as any).__PS_COLLECTION__ as { id: string; singular: string; slugs: string[]; reserved: string[]; ask: Record<string, Field> };
const api = `/api/editor/collection/${boot.id}`;

document.getElementById('ps-add-item')?.addEventListener('click', async () => {
  const add = `Add ${boot.singular}`;
  const asked = Object.keys(boot.ask).length > 0;
  const title = asked ? null : await promptDialog({ title: add, label: 'Title', submit: add });
  if (title) await create(title);
  else if (asked) askAll(add);
});

/** The title, and the required fields nothing else answers: without them the new file would break the site's build. */
function askAll(add: string) {
  const data: Record<string, unknown> = {};
  const box = document.createElement('div'); box.className = 'ps-newpage';
  const head = document.createElement('div');
  renderForm(head, { label: boot.singular, fields: { title: { type: 'text', label: 'Title', required: true } } }, {}, { pickImage, onChange: () => {} });
  const form = document.createElement('div');
  renderForm(form, { label: boot.singular, fields: boot.ask }, data, { pickImage, onChange: (name, value) => { data[name] = value; } });
  box.append(head, form);
  dialog(add, box, [{ label: 'Cancel' }, {
    label: add, kind: 'primary', run: async () => {
      const title = head.querySelector('input')!.value.trim();
      const missing = missingFields(boot.ask, data);
      showMissing(form, missing);
      showMissing(head, title ? [] : [{ path: ['title'], label: 'Title' }]);
      return missing.length || !title ? false : create(title, data);
    },
  }]);
}

/** False when it failed, which it has said. */
async function create(title: string, data?: Record<string, unknown>): Promise<false | void> {
  const slug = uniqueSlug(slugify(title) || boot.singular, [...boot.slugs, ...boot.reserved]);
  const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, slug, data }) });
  const d = await res.json();
  if (!res.ok) { toast(d.error || 'That did not work.', 'error'); return false; }
  location.href = `/edit/collection/${boot.id}/${d.slug}`;
}

document.getElementById('ps-pagelist')!.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-delete]');
  if (!b) return;
  const row = b.closest('li')!;
  const name = row.querySelector('strong')!.textContent;
  if (!await confirmDialog(`Delete ${boot.singular}`, `Delete "${name}"? It stays in the site's git history, so it can be recovered by a developer.`, 'Delete', 'danger')) return;
  const res = await fetch(`${api}/${b.dataset.delete}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Delete failed', 'error'); return; }
  row.remove();
  toast(`Deleted ${name}.`, 'ok');
});

const search = document.getElementById('ps-page-search') as HTMLInputElement;
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll<HTMLElement>('#ps-pagelist > li').forEach((li) => { const on = li.dataset.search!.includes(q); li.hidden = !on; if (on) shown++; });
  document.getElementById('ps-no-match')!.hidden = shown > 0;
});
