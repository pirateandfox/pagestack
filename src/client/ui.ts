// Small shared interface pieces: toasts, dialogs, popup menus. Menus work inside the preview
// iframe as well as in the shell, so they always build in the document of their anchor.

export interface ToastAction { label: string; run: () => void }

export function toast(text: string, kind: 'ok' | 'info' | 'warn' | 'error', opts: { href?: string; action?: ToastAction } = {}) {
  const t = document.createElement('div');
  t.className = `ps-toast ps-toast--${kind}`;
  t.setAttribute('role', 'status');
  t.textContent = text;
  if (opts.href) { const a = document.createElement('a'); a.href = opts.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open ↗'; t.append(' ', a); }
  if (opts.action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ps-toast__action'; b.textContent = opts.action.label; b.addEventListener('click', () => { t.remove(); opts.action!.run(); }); t.append(b); }
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Dismiss'); x.addEventListener('click', () => t.remove()); t.append(x);
  document.querySelectorAll('.ps-toast').forEach((o) => o.remove());
  document.body.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 15000 : 8000);
}

export interface DialogAction { label: string; kind?: 'primary' | 'danger'; run?: () => void | boolean | Promise<void | boolean> }

/** A modal. An action closes it unless `run` returns false. */
export function dialog(title: string, body: HTMLElement | string, actions: DialogAction[], opts: { wide?: boolean; onClose?: () => void } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'ps-modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', title);
  const box = document.createElement('form');
  box.className = `ps-dialog${opts.wide ? ' ps-dialog--wide' : ''}`;
  const h = document.createElement('h2'); h.textContent = title;
  const content = document.createElement('div'); content.className = 'ps-dialog__body';
  if (typeof body === 'string') { const p = document.createElement('p'); p.textContent = body; content.append(p); } else content.append(body);
  const foot = document.createElement('footer');
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); opts.onClose?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  let primary: HTMLButtonElement | undefined;
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = a.kind ? 'submit' : 'button';
    b.className = `ps-btn ${a.kind === 'primary' ? 'ps-btn--primary' : a.kind === 'danger' ? 'ps-btn--destructive' : 'ps-btn--ghost'}`;
    b.textContent = a.label;
    if (a.kind) primary = b;
    b.addEventListener('click', async (e) => { e.preventDefault(); b.disabled = true; const keep = (await a.run?.()) === false; b.disabled = false; if (!keep) close(); });
    foot.append(b);
  }
  box.addEventListener('submit', (e) => { e.preventDefault(); primary?.click(); });
  box.append(h, content, foot);
  wrap.append(box);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  (box.querySelector<HTMLElement>('input, textarea, select') ?? primary)?.focus();
  return { close, box };
}

export const confirmDialog = (title: string, text: string, label: string, kind: 'primary' | 'danger' = 'primary') =>
  new Promise<boolean>((resolve) => {
    let ok = false;
    dialog(title, text, [{ label: 'Cancel' }, { label, kind, run: () => { ok = true; } }], { onClose: () => resolve(ok) });
  });

/** Ask for one line of text. `check` returns a problem to show, or null. */
export function promptDialog(o: { title: string; label: string; value?: string; help?: string; submit: string; check?: (v: string) => string | null; toggle?: { label: string; on: boolean } }) {
  return new Promise<string | null>((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'ps-field';
    const label = document.createElement('label'); label.textContent = o.label;
    const input = document.createElement('input'); input.type = 'text'; input.value = o.value ?? ''; label.append(input);
    const error = document.createElement('p'); error.className = 'ps-error'; error.hidden = true;
    wrap.append(label, error);
    if (o.toggle) {
      const row = document.createElement('label'); row.className = 'ps-check';
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = o.toggle.on;
      box.addEventListener('change', () => { o.toggle!.on = box.checked; });
      row.append(box, ` ${o.toggle.label}`); wrap.append(row);
    }
    if (o.help) { const s = document.createElement('small'); s.className = 'ps-muted'; s.textContent = o.help; wrap.append(s); }
    let result: string | null = null;
    dialog(o.title, wrap, [{ label: 'Cancel' }, {
      label: o.submit, kind: 'primary', run: () => {
        const v = input.value.trim();
        const problem = o.check?.(v) ?? (v ? null : 'This cannot be empty.');
        if (problem) { error.textContent = problem; error.hidden = false; return false; }
        result = v;
      },
    }], { onClose: () => resolve(result) });
    input.select();
  });
}

export interface MenuItem { label: string; hint?: string; run: () => void; danger?: boolean; disabled?: boolean; separator?: boolean }

export function openMenu(anchor: HTMLElement, items: MenuItem[]) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView!;
  doc.querySelector('.ps-popmenu')?.remove();
  const menu = doc.createElement('div');
  menu.className = 'ps-popmenu';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (it.separator) menu.append(doc.createElement('hr'));
    const b = doc.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled;
    if (it.danger) b.className = 'is-danger';
    const span = doc.createElement('span'); span.textContent = it.label; b.append(span);
    if (it.hint) { const k = doc.createElement('kbd'); k.textContent = it.hint; b.append(k); }
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); close(); it.run(); });
    menu.append(b);
  }
  doc.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, win.innerHeight - size.height - 8))}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - size.width - 8))}px`;
  const onDown = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() { menu.remove(); doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown, true); }
  doc.addEventListener('mousedown', onDown, true);
  doc.addEventListener('keydown', onKey, true);
  if (doc !== document) document.addEventListener('mousedown', onDown, true);
  menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
}
