// Schema -> sidebar form. One widget per field type; changes are reported through `onChange`.
import type { BlockSchema, Field, ImageValue } from '../runtime';
import { formModel } from '../core/schema';

export interface FormCallbacks {
  onChange: (name: string, value: unknown, opts?: { live?: boolean }) => void;
  pickImage: (current: ImageValue | undefined, done: (img: ImageValue) => void) => void;
  pageUrls?: { url: string; title: string }[];
  icons?: Record<string, string>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
};

export function renderForm(root: HTMLElement, schema: BlockSchema, settings: Record<string, unknown>, cb: FormCallbacks) {
  root.innerHTML = '';
  const groups = formModel(schema, settings);
  if (!groups.length) { root.append(el('p', { class: 'ase-muted' }, 'This block has no settings.')); return; }
  for (const g of groups) {
    const body = el('div', { class: 'ase-fields' });
    for (const f of g.fields) body.append(fieldWidget(f.name, f.field, f.value, cb));
    const details = el('details', { class: 'ase-group', open: g.name !== 'advanced' }, el('summary', {}, g.label), body) as HTMLDetailsElement;
    root.append(details);
  }
}

function fieldWidget(name: string, field: Field, value: unknown, cb: FormCallbacks): HTMLElement {
  const id = `ase-f-${name}`;
  const label = el('label', { for: id }, field.label);
  const wrap = el('div', { class: `ase-field ase-field--${field.type}` }, label);
  const help = field.help ? el('small', { class: 'ase-muted' }, field.help) : null;
  const debounce = <T extends (...a: any[]) => void>(fn: T, ms = 250) => { let t: any; return (...a: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  switch (field.type) {
    case 'text':
    case 'link': {
      const input = el('input', { id, type: 'text', value: (value as string) ?? '', list: field.type === 'link' && cb.pageUrls?.length ? 'ase-page-urls' : undefined, placeholder: field.type === 'link' ? 'https://… or /page/' : '' }) as HTMLInputElement;
      const live = debounce(() => cb.onChange(name, input.value, { live: true }));
      input.addEventListener('input', live);
      input.addEventListener('change', () => cb.onChange(name, input.value));
      wrap.append(input);
      if (field.type === 'link' && cb.pageUrls?.length && !document.getElementById('ase-page-urls')) {
        document.body.append(el('datalist', { id: 'ase-page-urls' }, ...cb.pageUrls.map((p) => el('option', { value: p.url }, p.title))));
      }
      break;
    }
    case 'richtext':
    case 'textarea':
    case 'code': {
      const ta = el('textarea', { id, rows: field.type === 'code' ? 10 : 5, class: field.type === 'code' ? 'ase-mono' : '', spellcheck: 'false' }) as HTMLTextAreaElement;
      ta.value = (value as string) ?? '';
      ta.addEventListener('change', () => cb.onChange(name, ta.value));
      wrap.append(ta);
      if (field.type === 'richtext') wrap.append(el('small', { class: 'ase-muted' }, 'HTML source. Click the text in the page to edit it with formatting.'));
      break;
    }
    case 'number': {
      const input = el('input', { id, type: 'number', value: value ?? '', min: field.min, max: field.max, step: field.step ?? 1 }) as HTMLInputElement;
      input.addEventListener('change', () => cb.onChange(name, input.value === '' ? undefined : Number(input.value)));
      wrap.append(input);
      break;
    }
    case 'boolean': {
      const input = el('input', { id, type: 'checkbox' }) as HTMLInputElement;
      input.checked = !!value;
      input.addEventListener('change', () => cb.onChange(name, input.checked));
      wrap.className += ' ase-field--inline';
      wrap.innerHTML = ''; wrap.append(input, label);
      break;
    }
    case 'select': {
      const sel = el('select', { id }) as HTMLSelectElement;
      for (const o of field.options ?? []) sel.append(el('option', { value: o.value, selected: o.value === String(value ?? '') }, o.label));
      if (value !== undefined && !(field.options ?? []).some((o) => o.value === String(value))) sel.prepend(el('option', { value: String(value), selected: true }, `${value} (current)`));
      sel.addEventListener('change', () => cb.onChange(name, sel.value));
      wrap.append(sel);
      break;
    }
    case 'color': {
      const text = el('input', { id, type: 'text', value: (value as string) ?? '', placeholder: 'e.g. #BAA77E or var(--e-global-color-primary)' }) as HTMLInputElement;
      const swatch = el('input', { type: 'color', 'aria-label': `${field.label} picker` }) as HTMLInputElement;
      const sync = () => { const m = String(text.value).match(/^#([0-9a-f]{6})/i); swatch.value = m ? `#${m[1]}` : '#ffffff'; swatch.style.opacity = text.value ? '1' : '.4'; };
      sync();
      swatch.addEventListener('input', () => { text.value = swatch.value; cb.onChange(name, text.value, { live: true }); });
      swatch.addEventListener('change', () => cb.onChange(name, text.value));
      text.addEventListener('input', debounce(() => { sync(); cb.onChange(name, text.value, { live: true }); }));
      text.addEventListener('change', () => { sync(); cb.onChange(name, text.value); });
      const clear = el('button', { type: 'button', class: 'ase-btn ase-btn--small ase-btn--ghost', title: 'Clear (use theme CSS)', onclick: () => { text.value = ''; sync(); cb.onChange(name, ''); } }, '×');
      wrap.append(el('div', { class: 'ase-row' }, swatch, text, clear));
      break;
    }
    case 'image': {
      const img = (value as ImageValue) ?? { src: '', alt: '' };
      const thumb = el('div', { class: 'ase-thumb' }, img.src ? el('img', { src: img.src, alt: '' }) : el('span', { class: 'ase-muted' }, 'No image'));
      const alt = el('input', { type: 'text', value: img.alt ?? '', placeholder: 'Alt text (describe the image)', 'aria-label': 'Alt text' }) as HTMLInputElement;
      alt.addEventListener('change', () => cb.onChange(name, { ...img, alt: alt.value }));
      const choose = el('button', { type: 'button', class: 'ase-btn ase-btn--small', onclick: () => cb.pickImage(img.src ? img : undefined, (chosen) => cb.onChange(name, chosen)) }, img.src ? 'Replace…' : 'Choose…');
      const clear = el('button', { type: 'button', class: 'ase-btn ase-btn--small ase-btn--ghost', onclick: () => cb.onChange(name, { src: '', alt: '' }) }, 'Remove');
      wrap.append(thumb, el('div', { class: 'ase-row' }, choose, img.src ? clear : null));
      if (img.src) wrap.append(alt, el('small', { class: 'ase-muted ase-ellipsis', title: img.src }, img.src));
      break;
    }
    case 'svg': {
      const names = field.icons ?? Object.keys(cb.icons ?? {});
      const isNamed = typeof value === 'string' && names.includes(value);
      const sel = el('select', { id }) as HTMLSelectElement;
      sel.append(el('option', { value: '' }, 'None'));
      for (const n of names) sel.append(el('option', { value: n, selected: value === n }, n));
      sel.append(el('option', { value: '__custom', selected: !!value && !isNamed }, 'Custom SVG…'));
      const ta = el('textarea', { rows: 4, class: 'ase-mono', hidden: isNamed || !value, placeholder: '<svg …>…</svg>' }) as HTMLTextAreaElement;
      ta.value = !isNamed && typeof value === 'string' ? value : '';
      sel.addEventListener('change', () => { if (sel.value === '__custom') { ta.hidden = false; ta.focus(); } else { ta.hidden = true; cb.onChange(name, sel.value); } });
      ta.addEventListener('change', () => cb.onChange(name, ta.value));
      wrap.append(sel, ta);
      break;
    }
  }
  if (help) wrap.append(help);
  return wrap;
}
