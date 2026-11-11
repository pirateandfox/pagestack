// The list of a collection: add, delete, search.
import { slugify, uniqueSlug } from '../core/pages';
import { confirmDialog, promptDialog, toast } from './ui';

const boot = (window as any).__PS_COLLECTION__ as { id: string; singular: string; slugs: string[]; reserved: string[] };
const api = `/api/editor/collection/${boot.id}`;

document.getElementById('ps-add-item')?.addEventListener('click', async () => {
  const title = await promptDialog({ title: `Add ${boot.singular}`, label: 'Title', submit: `Add ${boot.singular}` });
  if (!title) return;
  const slug = uniqueSlug(slugify(title) || boot.singular, [...boot.slugs, ...boot.reserved]);
  const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, slug }) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'That did not work.', 'error'); return; }
  location.href = `/edit/collection/${boot.id}/${data.slug}`;
});

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
