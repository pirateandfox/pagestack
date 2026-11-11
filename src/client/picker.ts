// Image picker modal: browse the site's image library, search, or upload. Alt text is required.
import type { ImageValue } from '../runtime';
import { toast } from './ui';
import { uploadImage } from './upload';

export function pickImage(current: ImageValue | undefined, done: (img: ImageValue) => void) {
  const root = document.getElementById('ps-modal-root')!;
  root.innerHTML = `
    <div class="ps-modal" role="dialog" aria-modal="true" aria-label="Choose an image">
      <div class="ps-modal__box">
        <header class="ps-modal__head">
          <strong>Choose an image</strong>
          <input type="search" class="ps-picker__search" placeholder="Search by file name…" />
          <label class="ps-btn ps-btn--small">Upload… <input type="file" accept="image/*" multiple hidden /></label>
          <button type="button" class="ps-btn ps-btn--ghost ps-modal__close" aria-label="Close">×</button>
        </header>
        <div class="ps-picker__grid" aria-live="polite"><p class="ps-muted">Loading…</p></div>
        <div class="ps-picker__drop" hidden>Drop images to upload</div>
        <footer class="ps-modal__foot">
          <img class="ps-picker__preview" alt="" hidden />
          <div class="ps-picker__meta">
            <div class="ps-ellipsis ps-picker__src ps-muted"></div>
            <input type="text" class="ps-picker__alt" placeholder="Alt text (required): describe the image for screen readers" value="${esc(current?.alt ?? '')}" />
          </div>
          <button type="button" class="ps-btn ps-btn--primary ps-picker__use" disabled>Use image</button>
        </footer>
      </div>
    </div>`;
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  const grid = q('.ps-picker__grid');
  const search = q('.ps-picker__search') as HTMLInputElement;
  const altInput = q('.ps-picker__alt') as HTMLInputElement;
  const useBtn = q('.ps-picker__use') as HTMLButtonElement;
  const preview = q('.ps-picker__preview') as HTMLImageElement;
  const srcLabel = q('.ps-picker__src');
  let chosen: { src: string; width?: number; height?: number } | null = current?.src ? { src: current.src } : null;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  q('.ps-modal__close').addEventListener('click', close);
  q('.ps-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });

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
    if (!data.images?.length) { grid.innerHTML = '<p class="ps-muted">No images match.</p>'; return; }
    for (const img of data.images as { src: string; name: string }[]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ps-picker__item' + (chosen?.src === img.src ? ' is-selected' : ''); b.dataset.src = img.src; b.title = img.src;
      b.innerHTML = `<img loading="lazy" alt="" /><span class="ps-ellipsis">${esc(img.name)}</span>`;
      (b.firstElementChild as HTMLImageElement).src = img.src;
      b.addEventListener('click', () => select(img.src));
      grid.append(b);
    }
    if (data.total > data.images.length) grid.append(Object.assign(document.createElement('p'), { className: 'ps-muted', textContent: `Showing ${data.images.length} of ${data.total}. Search to narrow down.` }));
  }
  let t: any;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
  /** Uploads each file; the last one comes back selected, ready for its alt text. */
  async function upload(files: File[]) {
    if (!files.length) return;
    grid.insertAdjacentHTML('afterbegin', '<p class="ps-muted ps-picker__uploading">Uploading…</p>');
    let last: { src: string; file: File } | null = null;
    for (const file of files) {
      const { src, error } = await uploadImage(file);
      if (!src) { toast(`${file.name}: ${error}`, 'error'); continue; }
      last = { src, file };
    }
    grid.querySelector('.ps-picker__uploading')?.remove();
    if (!last) return;
    await load();
    select(last.src);
    if (!altInput.value) altInput.value = last.file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    validate();
  }
  (q('input[type=file]') as HTMLInputElement).addEventListener('change', (e) => upload([...(e.target as HTMLInputElement).files ?? []]));
  const box = q('.ps-modal__box'), drop = q('.ps-picker__drop');
  const hasFiles = (e: DragEvent) => [...e.dataTransfer?.types ?? []].includes('Files');
  box.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); drop.hidden = false; });
  box.addEventListener('dragleave', (e) => { if (e.target === drop) drop.hidden = true; });
  box.addEventListener('drop', (e) => { e.preventDefault(); drop.hidden = true; upload([...e.dataTransfer?.files ?? []].filter((f) => f.type.startsWith('image/'))); });
  if (current?.src) select(current.src);
  load();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
