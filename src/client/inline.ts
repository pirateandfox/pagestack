// In-page editing of text / richtext fields inside the preview iframe.
// - text: contenteditable="plaintext-only", Enter commits, Escape reverts.
// - text with `marks`: one line too, with just bold and italic (headings).
// - richtext: contenteditable with the floating formatting toolbar.
// Edits stream to `onInput` (silent draft updates); `onCommit` fires on blur.
import type { PageLink } from './rich';
import { sanitizeMarks } from '../core/sanitize';
import { cleanPaste, exec, linkPopover, markKey, marksPaste, marksToolbar, richToolbar } from './rich';

export interface InlineCallbacks {
  onStart: (fieldPath: string) => void;
  onInput: (fieldPath: string, value: string) => void;
  onCommit: (fieldPath: string, value: string, changed: boolean) => void;
  /** `/` typed in an empty field: the block inserter takes over. */
  onSlash?: (fieldPath: string) => void;
  /** Is this text field allowed bold and italic (`marks` in its schema)? */
  marks?: (fieldPath: string) => boolean;
  pages?: PageLink[];
}

export class InlineEditor {
  private active: { el: HTMLElement; path: string; type: string; original: string; toolbar?: HTMLElement } | null = null;
  constructor(private cb: InlineCallbacks) {}

  get isActive() { return !!this.active; }
  get activePath() { return this.active?.path ?? null; }

  start(el: HTMLElement) {
    if (this.active?.el === el) return;
    this.stop();
    const path = el.dataset.psField!;
    let type = el.dataset.psFieldType!;
    if (type !== 'text' && type !== 'richtext') return;
    if (type === 'text' && this.cb.marks?.(path)) type = 'marks';
    const original = el.innerHTML;
    this.active = { el, path, type, original };
    el.setAttribute('contenteditable', type === 'text' ? 'plaintext-only' : 'true');
    el.setAttribute('data-ps-editing', '');
    el.addEventListener('input', this.onInput);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('blur', this.onBlur);
    if (type !== 'text') el.addEventListener('paste', this.onPaste);
    el.focus();
    const doc = el.ownerDocument;
    // caret at end
    const range = doc.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = doc.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    if (type !== 'text') this.mountToolbar(el);
    this.cb.onStart(path);
  }

  stop(commit = true) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.el.removeEventListener('input', this.onInput);
    a.el.removeEventListener('keydown', this.onKey);
    a.el.removeEventListener('blur', this.onBlur);
    a.el.removeEventListener('paste', this.onPaste);
    a.el.removeAttribute('contenteditable');
    a.el.removeAttribute('data-ps-editing');
    a.el.ownerDocument.defaultView?.removeEventListener('scroll', this.place);
    a.toolbar?.remove();
    const value = this.read(a.el, a.type);
    if (commit) this.cb.onCommit(a.path, value, value !== this.read(this.parse(a.original, a.el), a.type));
    else { a.el.innerHTML = a.original; this.cb.onCommit(a.path, this.read(a.el, a.type), false); }
  }

  private parse(html: string, like: HTMLElement) { const t = like.ownerDocument.createElement(like.tagName); t.innerHTML = html; return t; }
  private read(el: HTMLElement, type: string): string {
    if (type === 'text') return el.textContent?.replace(/ /g, ' ') ?? '';
    if (type === 'marks') return sanitizeMarks(el.innerHTML);
    return el.innerHTML.trim();
  }

  private onInput = () => { const a = this.active; if (a) this.cb.onInput(a.path, this.read(a.el, a.type)); };
  private onPaste = (e: ClipboardEvent) => { const a = this.active; if (a) (a.type === 'marks' ? marksPaste : cleanPaste)(e, a.el, this.onInput); };
  private onKey = (e: KeyboardEvent) => {
    const a = this.active; if (!a) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.stop(false); return; }
    if (e.key === 'Enter' && a.type !== 'richtext') { e.preventDefault(); a.el.blur(); return; }
    if (e.key === '/' && !a.el.textContent?.trim() && this.cb.onSlash) { e.preventDefault(); this.cb.onSlash(a.path); return; }
    if (a.type === 'marks') { markKey(e, a.el, this.onInput); return; }
    if ((e.metaKey || e.ctrlKey) && a.type === 'richtext') {
      const k = e.key.toLowerCase();
      const cmd = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[k];
      if (cmd) { e.preventDefault(); exec(a.el, cmd); this.onInput(); } else if (k === 'k') { e.preventDefault(); linkPopover(a.el, a.toolbar!, this.richOptions()); }
    }
  };
  private onBlur = () => {
    // Clicking the toolbar also blurs; give it a tick to decide.
    setTimeout(() => { const a = this.active; if (!a) return; const doc = a.el.ownerDocument; if (doc.activeElement === a.el || a.toolbar?.contains(doc.activeElement)) return; this.stop(true); }, 120);
  };

  private richOptions() { return { pages: this.cb.pages, onChange: this.onInput, hint: 'Esc cancels' }; }

  private mountToolbar(el: HTMLElement) {
    const doc = el.ownerDocument;
    const tb = this.active!.type === 'marks' ? marksToolbar(el, this.onInput, 'Esc cancels') : richToolbar(el, this.richOptions());
    doc.body.append(tb);
    this.active!.toolbar = tb;
    this.place();
    doc.defaultView!.addEventListener('scroll', this.place, { passive: true });
  }
  /** Above the text, and held on screen while a long passage scrolls under it. */
  private place = () => {
    const a = this.active; if (!a?.toolbar) return;
    const r = a.el.getBoundingClientRect();
    const win = a.el.ownerDocument.defaultView!;
    const size = a.toolbar.getBoundingClientRect();
    a.toolbar.style.top = `${Math.max(6, Math.min(r.top - size.height - 8, r.bottom - size.height))}px`;
    a.toolbar.style.left = `${Math.max(6, Math.min(r.left, win.innerWidth - size.width - 6))}px`;
  };
}
