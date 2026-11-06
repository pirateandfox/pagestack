// The Media screen.
import { dialog, toast } from './ui';
import { uploadImage } from './upload';

interface Image { src: string; name: string; size?: number }
const grid = document.getElementById('ase-media-grid')!;
const search = document.getElementById('ase-media-search') as HTMLInputElement;
const count = document.getElementById('ase-media-count')!;
const drop = document.querySelector<HTMLElement>('.ase-media__drop')!;

const kb = (n?: number) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

async function load() {
  const res = await fetch(`/api/editor/images?limit=600&q=${encodeURIComponent(search.value.trim())}`);
  const { images, total } = await res.json() as { images: Image[]; total: number };
  count.textContent = String(total);
  grid.replaceChildren(...images.map(tile));
  if (!images.length) { const p = document.createElement('p'); p.className = 'ase-muted'; p.textContent = search.value ? 'No images match.' : 'No images yet.'; grid.append(p); }
}

function tile(img: Image) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ase-media__tile'; b.title = img.name; b.setAttribute('role', 'listitem');
  const pic = document.createElement('img'); pic.loading = 'lazy'; pic.alt = ''; pic.src = img.src;
  const name = document.createElement('span'); name.className = 'ase-ellipsis'; name.textContent = img.name;
  b.append(pic, name);
  b.addEventListener('click', () => details(img));
  return b;
}

async function remove(img: Image, force = false): Promise<boolean> {
  const res = await fetch('/api/editor/images', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: img.src, force }) });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Delete failed', 'error'); return false; }
  toast(`Deleted ${img.name}.`, 'ok');
  await load();
  return true;
}

async function details(img: Image) {
  const box = document.createElement('div'); box.className = 'ase-media__detail';
  const pic = document.createElement('img'); pic.src = img.src; pic.alt = '';
  const info = document.createElement('div');
  const url = Object.assign(document.createElement('input'), { type: 'text', readOnly: true, value: img.src, className: 'ase-invite__url' });
  url.setAttribute('aria-label', 'Image URL');
  const size = document.createElement('p'); size.className = 'ase-muted'; size.textContent = kb(img.size);
  const usedBox = document.createElement('div'); usedBox.textContent = 'Checking where this is used…'; usedBox.className = 'ase-muted';
  info.append(url, size, usedBox); box.append(pic, info);
  const used = fetch(`/api/editor/images?used=${encodeURIComponent(img.src)}`).then((r) => r.json()).then((d) => d.used as { title: string; href: string }[]);
  dialog(img.name, box, [
    { label: 'Close' },
    { label: 'Copy URL', run: async () => { await navigator.clipboard.writeText(img.src); toast('URL copied.', 'ok'); return false; } },
    { label: 'Delete', kind: 'danger', run: async () => remove(img, (await used).length > 0) },
  ], { wide: true });
  const list = await used;
  usedBox.textContent = list.length ? `Used in ${list.length} ${list.length === 1 ? 'place' : 'places'}. Deleting it will leave a broken image there:` : 'Not used anywhere.';
  if (list.length) {
    const ul = document.createElement('ul');
    for (const u of list) { const a = Object.assign(document.createElement('a'), { href: u.href, textContent: u.title }); const li = document.createElement('li'); li.append(a); ul.append(li); }
    usedBox.append(ul);
  }
}

async function upload(files: File[]) {
  if (!files.length) return;
  toast(`Uploading ${files.length} ${files.length === 1 ? 'image' : 'images'}…`, 'info');
  let done = 0;
  for (const f of files) {
    const { src, error } = await uploadImage(f);
    if (src) done++; else toast(`${f.name}: ${error}`, 'error');
  }
  if (done) { toast(`Uploaded ${done} ${done === 1 ? 'image' : 'images'}.`, 'ok'); await load(); }
}

let t: ReturnType<typeof setTimeout>;
search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
(document.getElementById('ase-media-file') as HTMLInputElement).addEventListener('change', (e) => { const i = e.target as HTMLInputElement; upload([...i.files ?? []]); i.value = ''; });
addEventListener('dragover', (e) => { e.preventDefault(); drop.hidden = false; });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.hidden = true; });
addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; upload([...e.dataTransfer?.files ?? []].filter((f) => f.type.startsWith('image/'))); });
load();
