// Image picker modal: browse the site's image library, search, or upload. Alt text is required.
import type { ImageValue } from '../runtime';
import { toast } from './ui';
import { uploadImage } from './upload';

export function pickImage(current: ImageValue | undefined, done: (img: ImageValue) => void) {
  const root = document.getElementById('ase-modal-root')!;
  root.innerHTML = `
    <div class="ase-modal" role="dialog" aria-modal="true" aria-label="Choose an image">
      <div class="ase-modal__box">
        <header class="ase-modal__head">
          <strong>Choose an image</strong>
          <input type="search" class="ase-picker__search" placeholder="Search by file name…" />
          <label class="ase-btn ase-btn--small">Upload… <input type="file" accept="image/*" multiple hidden /></label>
          <button type="button" class="ase-btn ase-btn--ghost ase-modal__close" aria-label="Close">×</button>
        </header>
        <div class="ase-picker__grid" aria-live="polite"><p class="ase-muted">Loading…</p></div>
        <div class="ase-picker__drop" hidden>Drop images to upload</div>
        <footer class="ase-modal__foot">
          <img class="ase-picker__preview" alt="" hidden />
          <div class="ase-picker__meta">
            <div class="ase-ellipsis ase-picker__src ase-muted"></div>
            <input type="text" class="ase-picker__alt" placeholder="Alt text (required): describe the image for screen readers" value="${esc(current?.alt ?? '')}" />
          </div>
          <button type="button" class="ase-btn ase-btn--primary ase-picker__use" disabled>Use image</button>
        </footer>
      </div>
    </div>`;
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const grid = q('.ase-picker__grid');
  const search = q('.ase-picker__search') as HTMLInputElement;
  const altInput = q('.ase-picker__alt') as HTMLInputElement;
  const useBtn = q('.ase-picker__use') as HTMLButtonElement;
  const preview = q('.ase-picker__preview') as HTMLImageElement;
  const srcLabel = q('.ase-picker__src');
  let chosen: { src: string; width?: number; height?: number } | null = current?.src ? { src: current.src } : null;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  q('.ase-modal__close').addEventListener('click', close);
  q('.ase-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });

  const select = (src: string) => {
    chosen = { src };
    preview.hidden = false; preview.src = src; srcLabel.textContent = src;
    preview.onload = () => { chosen = { src, width: preview.naturalWidth, height: preview.naturalHeight }; };
    grid.querySelectorAll('.is-selected').forEach((e) => e.classList.remove('is-selected'));
    grid.querySelector(`[data-src="${CSS.escape(src)}"]`)?.classList.add('is-selected');
    altInput.focus();
    validate();
  };
  const validate = () => { useBtn.disabled = !chosen || !altInput.value.trim(); };
  altInput.addEventListener('input', validate);
  useBtn.addEventListener('click', async () => {
    if (!chosen || !altInput.value.trim()) return;
    if (!chosen.width) { // make sure we know the natural size (used for width/height attributes)
      await new Promise<void>((r) => { const i = new Image(); i.onload = () => { chosen = { src: chosen!.src, width: i.naturalWidth, height: i.naturalHeight }; r(); }; i.onerror = () => r(); i.src = chosen!.src; setTimeout(r, 3000); });
    }
    done({ src: chosen.src, alt: altInput.value.trim(), width: chosen.width, height: chosen.height }); close();
  });

  let seq = 0;
  async function load() {
    const my = ++seq;
    const res = await fetch(`/api/editor/images?q=${encodeURIComponent(search.value.trim())}`);
    const data = await res.json();
    if (my !== seq) return;
    grid.innerHTML = '';
    if (!data.images?.length) { grid.innerHTML = '<p class="ase-muted">No images match.</p>'; return; }
    for (const img of data.images as { src: string; name: string }[]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ase-picker__item' + (chosen?.src === img.src ? ' is-selected' : ''); b.dataset.src = img.src; b.title = img.src;
      b.innerHTML = `<img loading="lazy" alt="" /><span class="ase-ellipsis">${esc(img.name)}</span>`;
      (b.firstElementChild as HTMLImageElement).src = img.src;
      b.addEventListener('click', () => select(img.src));
      grid.append(b);
    }
    if (data.total > data.images.length) grid.append(Object.assign(document.createElement('p'), { className: 'ase-muted', textContent: `Showing ${data.images.length} of ${data.total}. Search to narrow down.` }));
  }
  let t: any;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
  /** Uploads each file; the last one comes back selected, ready for its alt text. */
  async function upload(files: File[]) {
    if (!files.length) return;
    grid.insertAdjacentHTML('afterbegin', '<p class="ase-muted ase-picker__uploading">Uploading…</p>');
    let last: { src: string; file: File } | null = null;
    for (const file of files) {
      const { src, error } = await uploadImage(file);
      if (!src) { toast(`${file.name}: ${error}`, 'error'); continue; }
      last = { src, file };
    }
    grid.querySelector('.ase-picker__uploading')?.remove();
    if (!last) return;
    await load();
    select(last.src);
    if (!altInput.value) altInput.value = last.file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    validate();
  }
  (q('input[type=file]') as HTMLInputElement).addEventListener('change', (e) => upload([...(e.target as HTMLInputElement).files ?? []]));
  const box = q('.ase-modal__box'), drop = q('.ase-picker__drop');
  const hasFiles = (e: DragEvent) => [...e.dataTransfer?.types ?? []].includes('Files');
  box.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); drop.hidden = false; });
  box.addEventListener('dragleave', (e) => { if (e.target === drop) drop.hidden = true; });
  box.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; upload([...e.dataTransfer?.files ?? []].filter((f) => f.type.startsWith('image/'))); });
  if (current?.src) select(current.src);
  load();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
