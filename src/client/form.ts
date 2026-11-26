// Schema -> sidebar form. One widget per field type; changes are reported through `onChange`.
import type { BlockSchema, Field, ImageValue } from '../runtime';
import { formModel, isShown } from '../core/schema';
import type { Missing } from '../core/required';
import { marksField, richField } from './rich';

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
  if (!groups.length) { root.append(el('p', { class: 'ps-muted' }, 'This block has no settings.')); return; }
  const values = { ...settings };
  const shown = conditions(schema.fields, values);
  const formCb: FormCallbacks = { ...cb, onChange: (name, value, ...o) => { values[name] = value; cb.onChange(name, value, ...o); shown.update(); } };
  for (const g of groups) {
    const body = el('div', { class: 'ps-fields' });
    for (const f of g.fields) body.append(shown.track(f.name, fieldWidget(f.name, f.field, f.value, formCb)));
    const details = el('details', { class: 'ps-group', open: g.name !== 'advanced' }, el('summary', {}, g.label), body) as HTMLDetailsElement;
    shown.trackGroup(details, g.fields.map((f) => f.name));
    root.append(details);
  }
  shown.update();
}

/** Shows and hides a form's widgets by their fields' `showIf`, and a group with nothing left to show. */
function conditions(fields: Record<string, Field>, values: Record<string, unknown>) {
  const widgets = new Map<string, HTMLElement>();
  const groups: [HTMLElement, string[]][] = [];
  return {
    track: (name: string, widget: HTMLElement) => { widgets.set(name, widget); return widget; },
    trackGroup: (group: HTMLElement, names: string[]) => { groups.push([group, names]); },
    update: () => {
      for (const [name, w] of widgets) w.hidden = !isShown(name, fields, values);
      for (const [g, names] of groups) g.hidden = names.every((n) => widgets.get(n)!.hidden);
    },
  };
}

function fieldWidget(name: string, field: Field, value: unknown, cb: FormCallbacks, idPrefix = 'ps-f-'): HTMLElement {
  const id = `${idPrefix}${name}`;
  const label = el('label', { for: id }, field.label);
  const wrap = el('div', { class: `ps-field ps-field--${field.type}`, 'data-ps-form': id }, label);
  const outer = cb;
  cb = { ...cb, onChange: (...args) => { clearMissing(wrap); outer.onChange(...args); } };
  const help = field.help ? el('small', { class: 'ps-muted' }, field.help) : null;
  // `cancel` matters: a live update landing after `change` would reorder the edit and split its undo step.
  const debounce = (fn: () => void, ms = 250) => { let t: ReturnType<typeof setTimeout>; const run = () => { clearTimeout(t); t = setTimeout(fn, ms); }; run.cancel = () => clearTimeout(t); return run; };

  if (field.type === 'text' && field.marks) {
    wrap.append(marksField(id, (value as string) ?? '', (html, live) => cb.onChange(name, html, { live })));
    if (help) wrap.append(help);
    markRequired(wrap, field);
    return wrap;
  }
  switch (field.type) {
    case 'text':
    case 'link': {
      const input = el('input', { id, type: 'text', value: (value as string) ?? '', list: field.type === 'link' && cb.pageUrls?.length ? 'ps-page-urls' : undefined, placeholder: field.type === 'link' ? 'https://… or /page/' : '' }) as HTMLInputElement;
      const live = debounce(() => cb.onChange(name, input.value, { live: true }));
      input.addEventListener('input', live);
      input.addEventListener('change', () => { live.cancel(); cb.onChange(name, input.value); });
      wrap.append(input);
      if (field.type === 'link' && cb.pageUrls?.length && !document.getElementById('ps-page-urls')) {
        document.body.append(el('datalist', { id: 'ps-page-urls' }, ...cb.pageUrls.map((p) => el('option', { value: p.url }, p.title))));
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
      const ta = el('textarea', { id, rows: field.type === 'code' ? 10 : 5, class: field.type === 'code' ? 'ps-mono' : '', spellcheck: 'false' }) as HTMLTextAreaElement;
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
      wrap.className += ' ps-field--inline';
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
    case 'multiselect': {
      const current = (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map(String);
      const known = field.options ?? [];
      // Values no longer offered stay ticked until someone unticks them.
      const extra = [...new Set(current)].filter((v) => !known.some((o) => o.value === v)).map((v) => ({ value: v, label: `${v} (current)` }));
      const boxes = [...known, ...extra].map((o, i) => {
        const box = el('input', { id: `${id}-${i}`, type: 'checkbox', value: o.value, checked: current.includes(o.value) }) as HTMLInputElement;
        box.addEventListener('change', () => cb.onChange(name, boxes.filter((b) => b.box.checked).map((b) => b.box.value)));
        return { box, row: el('label', { for: `${id}-${i}` }, box, o.label) };
      });
      const heading = el('span', { class: 'ps-field__label', id: `${id}-label` }, field.label);
      label.replaceWith(heading);
      wrap.append(el('div', { id, class: 'ps-checks', role: 'group', 'aria-labelledby': `${id}-label` }, ...boxes.map((b) => b.row)));
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
      const clear = el('button', { type: 'button', class: 'ps-btn ps-btn--small ps-btn--ghost', title: 'Clear (use theme CSS)', onclick: () => { text.value = ''; sync(); cb.onChange(name, ''); } }, '×');
      wrap.append(el('div', { class: 'ps-row' }, swatch, text, clear));
      break;
    }
    case 'image': {
      // `asUrl` fields hold a bare URL (social images, menu pictures); the widget is the same.
      // It redraws itself: not every caller re-renders the form after a change.
      const box = el('div', { class: 'ps-field__image' });
      const sibling = () => { if (!field.asUrl || !field.altField) return null; let top: HTMLElement = box; while (top.parentElement) top = top.parentElement; return top.querySelector<HTMLInputElement>(`#${CSS.escape(idPrefix + field.altField)}`); };
      const draw = (img: ImageValue) => {
        const put = (v: ImageValue) => {
          cb.onChange(name, field.asUrl ? v.src : v);
          // The picker always asks for alt text; with a bare URL it belongs in the sibling field.
          if (field.asUrl && field.altField && v.src) {
            cb.onChange(field.altField, v.alt);
            const sib = sibling();
            if (sib) sib.value = v.alt;
          }
          draw(v);
        };
        const thumb = el('div', { class: 'ps-thumb' }, img.src ? el('img', { src: img.src, alt: '' }) : el('span', { class: 'ps-muted' }, 'No image'));
        const alt = el('input', { type: 'text', value: img.alt ?? '', placeholder: 'Alt text (describe the image)', 'aria-label': 'Alt text' }) as HTMLInputElement;
        alt.addEventListener('change', () => { img = { ...img, alt: alt.value }; cb.onChange(name, img); });
        const current = (): ImageValue | undefined => {
          if (!img.src) return undefined;
          const sib = sibling();
          return sib ? { ...img, alt: sib.value } : img;
        };
        const choose = el('button', { type: 'button', class: 'ps-btn ps-btn--small', onclick: () => cb.pickImage(current(), put) }, img.src ? 'Replace…' : 'Choose…');
        const clear = el('button', { type: 'button', class: 'ps-btn ps-btn--small ps-btn--ghost', onclick: () => put({ src: '', alt: '' }) }, 'Remove');
        box.replaceChildren(thumb, el('div', { class: 'ps-row' }, choose, img.src ? clear : null));
        if (img.src) box.append(...(field.asUrl ? [] : [alt]), el('small', { class: 'ps-muted ps-ellipsis', title: img.src }, img.src));
      };
      draw(field.asUrl ? { src: (value as string) ?? '', alt: '' } : ((value as ImageValue) ?? { src: '', alt: '' }));
      wrap.append(box);
      break;
    }
    case 'svg': {
      const names = field.icons ?? Object.keys(cb.icons ?? {});
      const isNamed = typeof value === 'string' && names.includes(value);
      const sel = el('select', { id }) as HTMLSelectElement;
      sel.append(el('option', { value: '' }, 'None'));
      for (const n of names) sel.append(el('option', { value: n, selected: value === n }, n));
      sel.append(el('option', { value: '__custom', selected: !!value && !isNamed }, 'Custom SVG…'));
      const ta = el('textarea', { rows: 4, class: 'ps-mono', hidden: isNamed || !value, placeholder: '<svg …>…</svg>' }) as HTMLTextAreaElement;
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
  markRequired(wrap, field);
  return wrap;
}

function markRequired(wrap: HTMLElement, field: Field) {
  if (!field.required || field.type === 'boolean') return;
  wrap.querySelector('label, .ps-field__label')?.append(el('span', { class: 'ps-req', 'aria-hidden': 'true', title: 'Required' }, ' *'));
  if (field.type !== 'list' && field.type !== 'multiselect' && field.type !== 'image') wrap.querySelector('input, select, textarea, [contenteditable]')?.setAttribute('aria-required', 'true');
}

function clearMissing(wrap: HTMLElement) {
  wrap.classList.remove('is-missing');
  wrap.querySelector(':scope > .ps-error')?.remove();
}

/** Takes what is still being typed: fields report when they are left, and a keyboard save doesn't leave them. */
export function commitTyping() {
  const at = document.activeElement;
  if (!(at instanceof HTMLElement) || !(at.isContentEditable || at.matches('input, textarea'))) return;
  const selection = getSelection();
  const caret = at.isContentEditable && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  at.blur();
  if (!at.isConnected) return;
  at.focus({ preventScroll: true });
  if (caret) { selection!.removeAllRanges(); selection!.addRange(caret); }
}

/** Points at each field that still needs a value, and goes to the first one in this form. */
export function showMissing(root: HTMLElement, missing: Missing[]) {
  root.querySelectorAll<HTMLElement>('.is-missing').forEach(clearMissing);
  const wraps = missing.flatMap((m) => root.querySelector<HTMLElement>(`[data-ps-form="${CSS.escape(`ps-f-${m.path.join('-')}`)}"]`) ?? []);
  for (const w of wraps) {
    w.classList.add('is-missing');
    w.append(el('p', { class: 'ps-error', role: 'alert' }, 'This is required.'));
    for (let d = w.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  }
  // The field itself, not a toolbar above it; a button where that is all there is (choose an image, add a row).
  const first = wraps[0];
  (first?.querySelector<HTMLElement>('input:not([type="file"]), select, textarea:not([hidden]), [contenteditable]') ?? first?.querySelector<HTMLElement>('button'))?.focus();
  wraps[0]?.scrollIntoView?.({ block: 'nearest' });
}

/** Repeatable rows, each its own little form. Rows can nest (a menu item holds links). */
function listWidget(name: string, field: Field, value: unknown, cb: FormCallbacks, id: string): HTMLElement {
  const fields = field.fields ?? {};
  let rows: Record<string, any>[] = Array.isArray(value) ? structuredClone(value) : [];
  const open = new Set<number>();
  const root = el('div', { class: 'ps-list', id });
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
      const title = el('span', { class: 'ps-ellipsis' }, rowName(row, i));
      const body = el('div', { class: 'ps-fields' });
      const shown = conditions(fields, row);
      for (const [k, sub] of Object.entries(fields)) {
        const rowCb: FormCallbacks = { ...cb, onChange: (key, v, o) => {
          // "None" over a default has to be stored, or the default comes back.
          const f = fields[key];
          const keep = (f?.type === 'select' || f?.type === 'multiselect') && String(f.default ?? '') !== '';
          if (v === undefined || (!keep && (v === '' || (Array.isArray(v) && !v.length)))) delete row[key]; else row[key] = v;
          if (key === field.itemLabel) { title.textContent = rowName(row, i); remove.setAttribute('aria-label', `Remove ${rowName(row, i)}`); }
          save(o?.live);
          shown.update();
        } };
        body.append(shown.track(k, fieldWidget(k, sub, row[k] ?? sub.default, rowCb, `${id}-${i}-`)));
      }
      shown.update();
      const remove = el('button', { type: 'button', title: 'Remove', 'aria-label': `Remove ${rowName(row, i)}`, onclick: (e: Event) => { e.preventDefault(); rows.splice(i, 1); open.clear(); save(); draw(); } }, '×');
      const details = el('details', { class: 'ps-list__row', open: open.has(i), ontoggle: () => { if (details.open) open.add(i); else open.delete(i); } }, el('summary', {},
        title,
        el('span', { class: 'ps-list__tools' },
          el('button', { type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: (e: Event) => { e.preventDefault(); move(i, i - 1); } }, '↑'),
          el('button', { type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === rows.length - 1, onclick: (e: Event) => { e.preventDefault(); move(i, i + 1); } }, '↓'),
          remove)), body) as HTMLDetailsElement;
      root.append(details);
    });
    root.append(el('button', { type: 'button', class: 'ps-btn ps-btn--small', onclick: () => {
      // A new row stores what it shows: defaults, and a dropdown's first choice.
      const row: Record<string, any> = {};
      for (const [k, sub] of Object.entries(fields)) {
        const v = sub.default ?? (sub.type === 'select' ? sub.options?.[0]?.value : undefined);
        if (v !== undefined && v !== '') row[k] = structuredClone(v);
      }
      rows.push(row);
      open.add(rows.length - 1);
      save(); draw();
    } }, '+ Add item'));
  };
  draw();
  return root;
}
