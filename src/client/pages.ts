// The Pages screen: search, add, duplicate, delete.
import { publicPath, slugify, slugProblem, uniqueSlug } from '../core/pages';
import { confirmDialog, dialog, toast } from './ui';

interface Boot { pages: { slug: string; title: string }[]; reserved: string[]; templates: { id: number; label: string; description?: string }[] }
const boot = (window as any).__PS_PAGES__ as Boot;
const existing = boot.pages.map((p) => p.slug);
const titleOnly = (t: string) => t.split(/\s[-–|]\s/)[0];

async function post(body: unknown) {
  const res = await fetch('/api/editor/pages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json() };
}

/** After creating: open the page, or, when the change went into a pull request, explain why not. */
function opened(data: any) {
  if (data.result?.pullRequest) { toast('The new page is in a pull request. It can be edited once that is merged.', 'ok', { href: data.result.pullRequest }); return; }
  location.href = `/edit/${data.slug}`;
}

function addPage(copyOf?: string) {
  const source = boot.pages.find((p) => p.slug === copyOf);
  const form = document.createElement('div');
  form.className = 'ps-newpage';
  form.innerHTML = `
    <div class="ps-field"><label>Title <input type="text" name="title" autocomplete="off" /></label></div>
    <div class="ps-field"><label>URL
      <span class="ps-prefixed"><span class="ps-muted">/</span><input type="text" name="slug" autocomplete="off" spellcheck="false" /><span class="ps-muted">/</span></span></label>
      <p class="ps-error" hidden></p></div>
    <div class="ps-field"><label>Start from <select name="from"></select></label></div>
    <small class="ps-muted">New pages start as drafts. Nothing is public until you press Publish.</small>`;
  const title = form.querySelector<HTMLInputElement>('[name=title]')!;
  const slug = form.querySelector<HTMLInputElement>('[name=slug]')!;
  const from = form.querySelector<HTMLSelectElement>('[name=from]')!;
  const error = form.querySelector<HTMLElement>('.ps-error')!;
  const option = (value: string, label: string, parent: HTMLElement = from) => { const o = document.createElement('option'); o.value = value; o.textContent = label; parent.append(o); };
  option('blank', 'Blank page');
  boot.templates.forEach((t) => option(`template:${t.id}`, t.label));
  const copies = document.createElement('optgroup'); copies.label = 'A copy of';
  boot.pages.forEach((p) => option(`copy:${p.slug}`, titleOnly(p.title), copies));
  from.append(copies);
  if (source) { from.value = `copy:${source.slug}`; title.value = `${titleOnly(source.title)} (copy)`; slug.value = uniqueSlug(`${source.slug}-copy`, existing); }
  else if (boot.templates.length) from.value = 'template:0';
  let touched = !!source;
  title.addEventListener('input', () => { if (!touched) slug.value = slugify(title.value); error.hidden = true; });
  slug.addEventListener('input', () => { touched = true; error.hidden = true; });

  dialog(source ? 'Duplicate page' : 'Add page', form, [{ label: 'Cancel' }, {
    label: source ? 'Duplicate' : 'Add page', kind: 'primary', run: async () => {
      const show = (m: string) => { error.textContent = m; error.hidden = false; return false; };
      if (!title.value.trim()) return show('Give the page a title.');
      const problem = slugProblem(slug.value.trim(), { existing, reserved: boot.reserved });
      if (problem) return show(problem);
      const [kind, value] = from.value.split(/:(.*)/);
      const { ok, data } = await post({ title: title.value.trim(), slug: slug.value.trim(), ...(kind === 'copy' ? { copyOf: value } : kind === 'template' ? { template: Number(value) } : {}) });
      if (!ok) return show(data.error ?? 'The page could not be created.');
      opened(data);
    },
  }]);
  title.focus();
  if (source) title.select();
}

async function deletePage(slug: string, row: HTMLElement) {
  const page = boot.pages.find((p) => p.slug === slug)!;
  if (!await confirmDialog('Delete page', `Delete "${titleOnly(page.title)}" (${publicPath(slug)})? It stays in the site's git history, so it can be recovered by a developer.`, 'Delete page', 'danger')) return;
  const res = await fetch(`/api/editor/page/${slug}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Delete failed', 'error'); return; }
  if (data.result?.pullRequest) { toast('The deletion is in a pull request.', 'ok', { href: data.result.pullRequest }); return; }
  row.remove();
  existing.splice(existing.indexOf(slug), 1);
  toast(`Deleted ${titleOnly(page.title)}.`, 'ok');
}

document.getElementById('ps-add-page')!.addEventListener('click', () => addPage());
document.getElementById('ps-pagelist')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-duplicate], [data-delete]');
  if (!b) return;
  if (b.dataset.duplicate) addPage(b.dataset.duplicate);
  else deletePage(b.dataset.delete!, b.closest('li')!);
});
const search = document.getElementById('ps-page-search') as HTMLInputElement;
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll<HTMLElement>('#ps-pagelist > li').forEach((li) => { const on = li.dataset.search!.includes(q); li.hidden = !on; if (on) shown++; });
  document.getElementById('ps-no-match')!.hidden = shown > 0;
});
