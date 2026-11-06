// Schema -> sidebar form. One widget per field type; changes are reported through `onChange`.
import type { BlockSchema, Field, ImageValue } from '../runtime';
import { formModel } from '../core/schema';
import { richField } from './rich';

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

function fieldWidget(name: string, field: Field, value: unknown, cb: FormCallbacks, idPrefix = 'ase-f-'): HTMLElement {
  const id = `${idPrefix}${name}`;
  const label = el('label', { for: id }, field.label);
  const wrap = el('div', { class: `ase-field ase-field--${field.type}` }, label);
  const help = field.help ? el('small', { class: 'ase-muted' }, field.help) : null;
  // `cancel` matters: a live update landing after `change` would reorder the edit and split its undo step.
  const debounce = (fn: () => void, ms = 250) => { let t: ReturnType<typeof setTimeout>; const run = () => { clearTimeout(t); t = setTimeout(fn, ms); }; run.cancel = () => clearTimeout(t); return run; };

  switch (field.type) {
    case 'text':
    case 'link': {
      const input = el('input', { id, type: 'text', value: (value as string) ?? '', list: field.type === 'link' && cb.pageUrls?.length ? 'ase-page-urls' : undefined, placeholder: field.type === 'link' ? 'https://… or /page/' : '' }) as HTMLInputElement;
      const live = debounce(() => cb.onChange(name, input.value, { live: true }));
      input.addEventListener('input', live);
      input.addEventListener('change', () => { live.cancel(); cb.onChange(name, input.value); });
      wrap.append(input);
      if (field.type === 'link' && cb.pageUrls?.length && !document.getElementById('ase-page-urls')) {
        document.body.append(el('datalist', { id: 'ase-page-urls' }, ...cb.pageUrls.map((p) => el('option', { value: p.url }, p.title))));
      }
      break;
    }
    case 'date': {
      // A day with no time isn't a valid datetime-local value and would show as blank.
      const dayOnly = field.time === false || /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
      const input = el('input', dayOnly
        ? { id, type: 'date', value: String(value ?? '').slice(0, 10) }
        : { id, type: 'datetime-local', step: '1', value: String(value ?? '').slice(0, 19) }) as HTMLInputElement;
      input.addEventListener('change', () => cb.onChange(name, input.value));
      wrap.append(input);
      break;
    }
    case 'tags': {
      const input = el('input', { id, type: 'text', value: Array.isArray(value) ? value.join(', ') : '', placeholder: 'Separate with commas' }) as HTMLInputElement;
      input.addEventListener('change', () => cb.onChange(name, input.value.split(',').map((t) => t.trim()).filter(Boolean)));
      wrap.append(input);
      break;
    }
    case 'richtext':
      wrap.append(richField(id, (value as string) ?? '', (html, live) => cb.onChange(name, html, { live }), cb.pageUrls));
      break;
    case 'textarea':
    case 'code': {
      const ta = el('textarea', { id, rows: field.type === 'code' ? 10 : 5, class: field.type === 'code' ? 'ase-mono' : '', spellcheck: 'false' }) as HTMLTextAreaElement;
      ta.value = (value as string) ?? '';
      ta.addEventListener('change', () => cb.onChange(name, ta.value));
      wrap.append(ta);
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
      const live = debounce(() => { sync(); cb.onChange(name, text.value, { live: true }); });
      text.addEventListener('input', live);
      text.addEventListener('change', () => { live.cancel(); sync(); cb.onChange(name, text.value); });
      const clear = el('button', { type: 'button', class: 'ase-btn ase-btn--small ase-btn--ghost', title: 'Clear (use theme CSS)', onclick: () => { text.value = ''; sync(); cb.onChange(name, ''); } }, '×');
      wrap.append(el('div', { class: 'ase-row' }, swatch, text, clear));
      break;
    }
    case 'image': {
      // `asUrl` fields hold a bare URL (social images, menu pictures); the widget is the same.
      const img: ImageValue = field.asUrl ? { src: (value as string) ?? '', alt: '' } : ((value as ImageValue) ?? { src: '', alt: '' });
      const put = (v: ImageValue) => cb.onChange(name, field.asUrl ? v.src : v);
      const thumb = el('div', { class: 'ase-thumb' }, img.src ? el('img', { src: img.src, alt: '' }) : el('span', { class: 'ase-muted' }, 'No image'));
      const alt = el('input', { type: 'text', value: img.alt ?? '', placeholder: 'Alt text (describe the image)', 'aria-label': 'Alt text' }) as HTMLInputElement;
      alt.addEventListener('change', () => put({ ...img, alt: alt.value }));
      const choose = el('button', { type: 'button', class: 'ase-btn ase-btn--small', onclick: () => cb.pickImage(img.src ? img : undefined, put) }, img.src ? 'Replace…' : 'Choose…');
      const clear = el('button', { type: 'button', class: 'ase-btn ase-btn--small ase-btn--ghost', onclick: () => put({ src: '', alt: '' }) }, 'Remove');
      wrap.append(thumb, el('div', { class: 'ase-row' }, choose, img.src ? clear : null));
      if (img.src) wrap.append(...(field.asUrl ? [] : [alt]), el('small', { class: 'ase-muted ase-ellipsis', title: img.src }, img.src));
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
    case 'list':
      wrap.append(listWidget(name, field, value, cb, id));
      break;
  }
  if (help) wrap.append(help);
  return wrap;
}

/** Repeatable rows, each its own little form. Rows can nest (a menu item holds links). */
function listWidget(name: string, field: Field, value: unknown, cb: FormCallbacks, id: string): HTMLElement {
  const fields = field.fields ?? {};
  let rows: Record<string, any>[] = Array.isArray(value) ? structuredClone(value) : [];
  const open = new Set<number>();
  const root = el('div', { class: 'ase-list', id });
  const rowName = (row: Record<string, any>, i: number) => (field.itemLabel && row[field.itemLabel]) || `Item ${i + 1}`;
  const save = (live = false) => cb.onChange(name, structuredClone(rows), { live });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return;
    rows.splice(to, 0, rows.splice(from, 1)[0]);
    const was = [from, to].map((i) => open.has(i));
    [to, from].forEach((i, k) => { if (was[k]) open.add(i); else open.delete(i); });
    save(); draw();
  };
  const draw = () => {
    root.innerHTML = '';
    rows.forEach((row, i) => {
      const title = el('span', { class: 'ase-ellipsis' }, rowName(row, i));
      const body = el('div', { class: 'ase-fields' });
      for (const [k, sub] of Object.entries(fields)) {
        const rowCb: FormCallbacks = { ...cb, onChange: (key, v, o) => {
          if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete row[key]; else row[key] = v;
          if (key === field.itemLabel) { title.textContent = rowName(row, i); remove.setAttribute('aria-label', `Remove ${rowName(row, i)}`); }
          save(o?.live);
        } };
        body.append(fieldWidget(k, sub, row[k] ?? sub.default, rowCb, `${id}-${i}-`));
      }
      const remove = el('button', { type: 'button', title: 'Remove', 'aria-label': `Remove ${rowName(row, i)}`, onclick: (e: Event) => { e.preventDefault(); rows.splice(i, 1); open.clear(); save(); draw(); } }, '×');
      const details = el('details', { class: 'ase-list__row', open: open.has(i), ontoggle: () => { if (details.open) open.add(i); else open.delete(i); } }, el('summary', {},
        title,
        el('span', { class: 'ase-list__tools' },
          el('button', { type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: (e: Event) => { e.preventDefault(); move(i, i - 1); } }, '↑'),
          el('button', { type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === rows.length - 1, onclick: (e: Event) => { e.preventDefault(); move(i, i + 1); } }, '↓'),
          remove)), body) as HTMLDetailsElement;
      root.append(details);
    });
    root.append(el('button', { type: 'button', class: 'ase-btn ase-btn--small', onclick: () => {
      rows.push({});
      open.add(rows.length - 1);
      save(); draw();
    } }, '+ Add item'));
  };
  draw();
  return root;
}
