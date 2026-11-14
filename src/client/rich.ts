// Rich text formatting, shared by in-page editing and the sidebar: the toolbar, the link popover
// and clean paste. Everything acts on one contenteditable element, in whichever document it lives.
import { safeUrl, sanitizeHtml, sanitizeMarks } from '../core/sanitize';

export interface PageLink { url: string; title: string }
export interface RichOptions { pages?: PageLink[]; onChange: () => void; hint?: string }

const LINE = /^(h[1-6]|p|blockquote|div)$/;
const BUTTONS: { cmd: string; title: string; html: string; arg?: string; sep?: boolean }[] = [
  { cmd: 'bold', title: 'Bold (⌘B)', html: '<b>B</b>' },
  { cmd: 'italic', title: 'Italic (⌘I)', html: '<i>I</i>' },
  { cmd: 'underline', title: 'Underline (⌘U)', html: '<u>U</u>' },
  { cmd: 'strikeThrough', title: 'Strikethrough', html: '<s>S</s>' },
  { cmd: 'link', title: 'Link (⌘K)', html: 'Link', sep: true },
  { cmd: 'formatBlock', arg: 'h2', title: 'Heading', html: 'H2', sep: true },
  { cmd: 'formatBlock', arg: 'h3', title: 'Subheading', html: 'H3' },
  { cmd: 'formatBlock', arg: 'p', title: 'Paragraph', html: '¶' },
  { cmd: 'formatBlock', arg: 'blockquote', title: 'Quote', html: '❝' },
  { cmd: 'insertUnorderedList', title: 'Bulleted list', html: '•≡', sep: true },
  { cmd: 'insertOrderedList', title: 'Numbered list', html: '1≡' },
  { cmd: 'removeFormat', title: 'Clear formatting', html: 'Tx', sep: true },
];

export function exec(target: HTMLElement, cmd: string, arg?: string) {
  const doc = target.ownerDocument;
  target.focus();
  doc.execCommand('defaultParagraphSeparator', false, 'p');
  const styled = new Set(target.querySelectorAll('[style]'));
  doc.execCommand(cmd, false, arg);
  // Chrome writes computed styles onto what it inserts; those would pin one font size into the content.
  target.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    if (styled.has(el)) return;
    el.removeAttribute('style');
    if (el.tagName === 'SPAN' && !el.attributes.length) el.replaceWith(...el.childNodes);
  });
}

/** Bold / italic / link… buttons for `target`. Pressing one never takes the selection away. */
export function richToolbar(target: HTMLElement, o: RichOptions): HTMLElement {
  const doc = target.ownerDocument;
  const bar = doc.createElement('div');
  bar.setAttribute('data-ps-toolbar', '');
  bar.className = 'ps-rt';
  for (const b of BUTTONS) {
    if (b.sep) { const s = doc.createElement('span'); s.className = 'ps-rt__sep'; bar.append(s); }
    const el = doc.createElement('button');
    el.type = 'button'; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.cmd; if (b.arg) el.dataset.arg = b.arg;
    el.innerHTML = b.html;
    bar.append(el);
  }
  if (o.hint) { const h = doc.createElement('span'); h.className = 'ps-rt__hint'; h.textContent = o.hint; bar.append(h); }
  bar.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('.ps-link')) e.preventDefault(); });
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
    if (!b) return;
    e.preventDefault();
    const { cmd, arg } = b.dataset;
    if (cmd === 'link') { linkPopover(target, bar, o); return; }
    // Pressing the active heading button again turns the line back into a paragraph.
    const same = cmd === 'formatBlock' && lineTag(target) === arg;
    exec(target, cmd!, same ? 'p' : arg);
    o.onChange();
    syncToolbar(target, bar);
  });
  const sync = () => { if (bar.isConnected) syncToolbar(target, bar); else doc.removeEventListener('selectionchange', sync); };
  doc.addEventListener('selectionchange', sync);
  return bar;
}

function lineTag(target: HTMLElement): string {
  const sel = target.ownerDocument.getSelection();
  let n: Node | null | undefined = sel?.anchorNode;
  while (n && n !== target) {
    if (n.nodeType === 1 && LINE.test((n as Element).tagName.toLowerCase())) return (n as Element).tagName.toLowerCase();
    n = n.parentNode;
  }
  return 'p';
}

function syncToolbar(target: HTMLElement, bar: HTMLElement) {
  const doc = target.ownerDocument;
  const sel = doc.getSelection();
  if (!sel?.anchorNode || !target.contains(sel.anchorNode)) return;
  const tag = lineTag(target);
  bar.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
    const { cmd, arg } = b.dataset;
    let on = false;
    if (cmd === 'formatBlock') on = tag === arg && arg !== 'p';
    else if (cmd === 'link') on = !!anchorAt(target);
    else if (cmd !== 'removeFormat') { try { on = doc.queryCommandState(cmd!); } catch { /* unsupported command */ } }
    b.classList.toggle('is-on', on);
  });
}

function anchorAt(target: HTMLElement): HTMLAnchorElement | null {
  const n = target.ownerDocument.getSelection()?.anchorNode;
  const el = n && (n.nodeType === 1 ? n as Element : n.parentElement);
  const a = el?.closest('a') ?? null;
  return a && target.contains(a) ? a as HTMLAnchorElement : null;
}

/** "example.com" means a website, not a relative path. */
export function normalizeUrl(input: string): string {
  const v = input.trim();
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v) && !/\.(html?|pdf)$/i.test(v)) return `https://${v}`;
  if (/^[^\s/:@]+@[^\s/:@]+\.[a-z]+$/i.test(v)) return `mailto:${v}`;
  return v;
}

/** Link editor: type a URL or search the site's pages, like WordPress's link control. */
export function linkPopover(target: HTMLElement, bar: HTMLElement, o: RichOptions) {
  const doc = target.ownerDocument;
  bar.querySelector('.ps-link')?.remove();
  const sel = doc.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const existing = anchorAt(target);
  const pop = doc.createElement('div');
  pop.className = 'ps-link';
  pop.innerHTML = `<input type="text" placeholder="Search pages or paste a URL" aria-label="Link" /><div class="ps-link__results" role="listbox"></div><label class="ps-link__tab"><input type="checkbox" /> Open in new tab</label><p class="ps-link__error" hidden>That link type is not allowed.</p><div class="ps-link__actions"><button type="button" data-do="remove">Remove link</button><button type="button" data-do="apply" class="is-primary">Apply</button></div>`;
  const input = pop.querySelector<HTMLInputElement>('input[type=text]')!;
  const tab = pop.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const results = pop.querySelector<HTMLElement>('.ps-link__results')!;
  const error = pop.querySelector<HTMLElement>('.ps-link__error')!;
  const remove = pop.querySelector<HTMLElement>('[data-do=remove]')!;
  input.value = existing?.getAttribute('href') ?? '';
  tab.checked = existing?.target === '_blank';
  remove.hidden = !existing;

  const restore = () => { target.focus(); if (range) { sel?.removeAllRanges(); sel?.addRange(range); } };
  const close = () => { pop.remove(); restore(); };
  const showResults = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = '';
    if (/^(https?:|mailto:|tel:|#)/.test(q)) return;
    for (const p of (o.pages ?? []).filter((x) => !q || `${x.title} ${x.url}`.toLowerCase().includes(q)).slice(0, 6)) {
      const b = doc.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'option');
      const t = doc.createElement('strong'); t.textContent = p.title;
      const u = doc.createElement('span'); u.textContent = p.url;
      b.append(t, u);
      b.addEventListener('click', () => { input.value = p.url; apply(); });
      results.append(b);
    }
  };
  const apply = () => {
    const url = normalizeUrl(input.value);
    if (!url) { unlink(); return; }
    if (!safeUrl(url)) { error.hidden = false; return; }
    pop.remove(); restore();
    const newTab = tab.checked;
    if (existing) { existing.setAttribute('href', url); setTab(existing, newTab); }
    else if (range?.collapsed !== false) {
      const a = doc.createElement('a'); a.setAttribute('href', url); setTab(a, newTab);
      a.textContent = o.pages?.find((p) => p.url === url)?.title ?? url;
      exec(target, 'insertHTML', a.outerHTML);
    } else {
      exec(target, 'createLink', url);
      target.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => { if (a.getAttribute('href') === url) setTab(a, newTab); });
    }
    o.onChange();
  };
  const unlink = () => {
    pop.remove(); restore();
    if (existing) { const r = doc.createRange(); r.selectNodeContents(existing); sel?.removeAllRanges(); sel?.addRange(r); }
    exec(target, 'unlink');
    o.onChange();
  };
  pop.addEventListener('mousedown', (e) => e.stopPropagation());
  pop.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  pop.querySelector('[data-do=apply]')!.addEventListener('click', apply);
  remove.addEventListener('click', unlink);
  input.addEventListener('input', () => { error.hidden = true; showResults(); });
  bar.append(pop);
  showResults();
  input.focus();
  input.select();
}

function setTab(a: Element, newTab: boolean) {
  if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
}

/** Paste as clean structure: bold, links and lists survive, another site's styling does not. */
export function cleanPaste(e: ClipboardEvent, target: HTMLElement, onChange: () => void) {
  const data = e.clipboardData;
  if (!data) return;
  e.preventDefault();
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = text.split(/\n{2,}/);
  const cleaned = html
    ? sanitizeHtml(html.replace(/<b[^>]*docs-internal-guid[^>]*>/i, ''), { paste: true })
    : parts.length > 1 ? parts.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : esc(text);
  exec(target, 'insertHTML', cleaned);
  onChange();
}

/** The sidebar's rich text field: the same formatting as in the page, with an HTML escape hatch. */
export function richField(id: string, value: string, onChange: (html: string, live: boolean) => void, pages?: PageLink[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ps-rich';
  const body = document.createElement('div');
  body.id = id; body.className = 'ps-rich__body'; body.contentEditable = 'true'; body.setAttribute('role', 'textbox'); body.setAttribute('aria-multiline', 'true');
  body.innerHTML = sanitizeHtml(value);
  let last = value, timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (live: boolean) => { clearTimeout(timer); const html = body.innerHTML; if (html !== last) { last = html; onChange(html, live); } };
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => emit(true), 250); };
  const bar = richToolbar(body, { pages, onChange: () => emit(true) });
  const source = document.createElement('textarea');
  source.rows = 6; source.className = 'ps-mono'; source.hidden = true; source.setAttribute('aria-label', 'HTML source'); source.spellcheck = false;
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'ps-rich__source'; toggle.textContent = 'HTML';
  toggle.addEventListener('click', () => {
    const toSource = source.hidden;
    if (toSource) source.value = body.innerHTML; else { body.innerHTML = sanitizeHtml(source.value); emit(false); }
    source.hidden = !toSource; body.hidden = toSource;
    bar.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => { b.disabled = toSource; });
    toggle.classList.toggle('is-on', toSource);
  });
  bar.append(toggle);
  body.addEventListener('input', changed);
  body.addEventListener('blur', () => emit(false));
  body.addEventListener('paste', (e) => cleanPaste(e, body, changed));
  body.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); linkPopover(body, bar, { pages, onChange: () => emit(true) }); } });
  box.append(bar, body, source);
  return box;
}

// ---- Bold and italic in one line (text fields with `marks`) ----
// Headings are usually bold already, and the browser's own bold command "unbolds" them with inline
// styles we strip, so these two marks are applied by hand: wrap the selection, or unwrap the mark it's in.

const MARK_TAGS = { bold: ['STRONG', 'B'], italic: ['EM', 'I'] } as const;
type Mark = keyof typeof MARK_TAGS;

function markAt(target: HTMLElement, mark: Mark, node: Node | null | undefined): HTMLElement | null {
  for (let n = node; n && n !== target; n = n.parentNode) if (n.nodeType === 1 && (MARK_TAGS[mark] as readonly string[]).includes((n as Element).tagName)) return n as HTMLElement;
  return null;
}

/** Wraps the selection in <strong>/<em>, or takes the mark off when the selection is already inside one. */
export function toggleMark(target: HTMLElement, mark: Mark): boolean {
  const doc = target.ownerDocument;
  const sel = doc.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) return false;
  const inside = markAt(target, mark, range.commonAncestorContainer);
  if (inside) {
    const first = inside.firstChild, last = inside.lastChild;
    inside.replaceWith(...inside.childNodes);
    if (first && last) { const r = doc.createRange(); r.setStartBefore(first); r.setEndAfter(last); sel.removeAllRanges(); sel.addRange(r); }
    target.normalize();
    return true;
  }
  if (range.collapsed) return false;
  const frag = range.extractContents();
  frag.querySelectorAll(MARK_TAGS[mark].join(',')).forEach((el) => el.replaceWith(...el.childNodes));
  const wrap = doc.createElement(mark === 'bold' ? 'strong' : 'em');
  wrap.append(frag);
  range.insertNode(wrap);
  const r = doc.createRange(); r.selectNodeContents(wrap); sel.removeAllRanges(); sel.addRange(r);
  return true;
}

/** Just B and I, for one line. */
export function marksToolbar(target: HTMLElement, onChange: () => void, hint?: string): HTMLElement {
  const doc = target.ownerDocument;
  const bar = doc.createElement('div');
  bar.setAttribute('data-ps-toolbar', '');
  bar.className = 'ps-rt ps-rt--marks';
  for (const b of BUTTONS.filter((x) => x.cmd === 'bold' || x.cmd === 'italic')) {
    const el = doc.createElement('button');
    el.type = 'button'; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.cmd;
    el.innerHTML = b.html;
    bar.append(el);
  }
  if (hint) { const h = doc.createElement('span'); h.className = 'ps-rt__hint'; h.textContent = hint; bar.append(h); }
  const sync = () => {
    if (!bar.isConnected) { doc.removeEventListener('selectionchange', sync); return; }
    const n = doc.getSelection()?.anchorNode;
    if (!n || !target.contains(n)) return;
    bar.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => b.classList.toggle('is-on', !!markAt(target, b.dataset.cmd as Mark, n)));
  };
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]');
    if (!b) return;
    e.preventDefault();
    target.focus();
    if (toggleMark(target, b.dataset.cmd as Mark)) onChange();
    sync();
  });
  doc.addEventListener('selectionchange', sync);
  return bar;
}

/** ⌘B / ⌘I in a one-line field. True when the key was handled. */
export function markKey(e: KeyboardEvent, target: HTMLElement, onChange: () => void): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const mark = ({ b: 'bold', i: 'italic' } as Record<string, Mark>)[e.key.toLowerCase()];
  if (!mark) return false;
  e.preventDefault();
  if (toggleMark(target, mark)) onChange();
  return true;
}

/** Paste into one line: bold and italic survive, everything else becomes plain words. */
export function marksPaste(e: ClipboardEvent, target: HTMLElement, onChange: () => void) {
  const data = e.clipboardData;
  if (!data) return;
  e.preventDefault();
  const html = data.getData('text/html');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clean = html ? sanitizeMarks(html.replace(/<b[^>]*docs-internal-guid[^>]*>/i, '')) : esc(data.getData('text/plain').replace(/\s+/g, ' ').trim());
  target.ownerDocument.execCommand('insertHTML', false, clean || ' ');
  onChange();
}

/** The sidebar's version of a text field with `marks`: one line you can make bold or italic. */
export function marksField(id: string, value: string, onChange: (html: string, live: boolean) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ps-rich ps-rich--line';
  const body = document.createElement('div');
  body.id = id; body.className = 'ps-rich__body'; body.contentEditable = 'true'; body.setAttribute('role', 'textbox');
  body.innerHTML = sanitizeMarks(value);
  let last = body.innerHTML, timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (live: boolean) => { clearTimeout(timer); const html = sanitizeMarks(body.innerHTML); if (html !== last) { last = html; onChange(html, live); } };
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => emit(true), 250); };
  body.addEventListener('input', changed);
  body.addEventListener('blur', () => emit(false));
  body.addEventListener('paste', (e) => marksPaste(e, body, changed));
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); emit(false); return; }
    markKey(e, body, () => emit(true));
  });
  box.append(marksToolbar(body, () => emit(true)), body);
  return box;
}
