// In-page editing of text / richtext fields inside the preview iframe.
// - text: contenteditable="plaintext-only", Enter commits, Escape reverts.
// - richtext: contenteditable with a tiny floating toolbar (bold, italic, link, clear).
// Edits stream to `onInput` (silent draft updates); `onCommit` fires on blur.

export interface InlineCallbacks {
  onStart: (fieldPath: string) => void;
  onInput: (fieldPath: string, value: string) => void;
  onCommit: (fieldPath: string, value: string, changed: boolean) => void;
}

export class InlineEditor {
  private active: { el: HTMLElement; path: string; type: string; original: string; toolbar?: HTMLElement } | null = null;
  constructor(private cb: InlineCallbacks) {}

  get isActive() { return !!this.active; }
  get activePath() { return this.active?.path ?? null; }

  start(el: HTMLElement) {
    if (this.active?.el === el) return;
    this.stop();
    const path = el.dataset.aseField!;
    const type = el.dataset.aseFieldType!;
    if (type !== 'text' && type !== 'richtext') return;
    const original = type === 'text' ? el.innerHTML : el.innerHTML;
    this.active = { el, path, type, original };
    el.setAttribute('contenteditable', type === 'text' ? 'plaintext-only' : 'true');
    el.setAttribute('data-ase-editing', '');
    el.addEventListener('input', this.onInput);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('blur', this.onBlur);
    el.focus();
    const doc = el.ownerDocument;
    // caret at end
    const range = doc.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = doc.getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    if (type === 'richtext') this.mountToolbar(el);
    this.cb.onStart(path);
  }

  stop(commit = true) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.el.removeEventListener('input', this.onInput);
    a.el.removeEventListener('keydown', this.onKey);
    a.el.removeEventListener('blur', this.onBlur);
    a.el.removeAttribute('contenteditable');
    a.el.removeAttribute('data-ase-editing');
    a.toolbar?.remove();
    const value = this.read(a.el, a.type);
    if (commit) this.cb.onCommit(a.path, value, value !== this.read(this.parse(a.original, a.el), a.type));
    else { a.el.innerHTML = a.original; this.cb.onCommit(a.path, this.read(a.el, a.type), false); }
  }

  private parse(html: string, like: HTMLElement) { const t = like.ownerDocument.createElement(like.tagName); t.innerHTML = html; return t; }
  private read(el: HTMLElement, type: string): string {
    if (type === 'text') return el.textContent?.replace(/ /g, ' ') ?? '';
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-ase-toolbar]').forEach((t) => t.remove());
    return clone.innerHTML.trim();
  }

  private onInput = () => { const a = this.active; if (a) this.cb.onInput(a.path, this.read(a.el, a.type)); };
  private onKey = (e: KeyboardEvent) => {
    const a = this.active; if (!a) return;
    if (e.key === 'Escape') { e.preventDefault(); this.stop(false); return; }
    if (e.key === 'Enter' && a.type === 'text') { e.preventDefault(); a.el.blur(); return; }
    if ((e.metaKey || e.ctrlKey) && a.type === 'richtext') {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); this.exec('bold'); } else if (k === 'i') { e.preventDefault(); this.exec('italic'); } else if (k === 'k') { e.preventDefault(); this.link(); }
    }
  };
  private onBlur = () => {
    // Clicking the toolbar also blurs; give it a tick to decide.
    setTimeout(() => { const a = this.active; if (!a) return; const doc = a.el.ownerDocument; if (doc.activeElement === a.el || a.toolbar?.contains(doc.activeElement)) return; this.stop(true); }, 120);
  };

  private exec(cmd: string, arg?: string) {
    const a = this.active; if (!a) return;
    a.el.ownerDocument.execCommand(cmd, false, arg);
    a.el.focus();
    this.onInput();
  }
  private link() {
    const a = this.active; if (!a) return;
    const doc = a.el.ownerDocument;
    const sel = doc.getSelection();
    const anchor = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode as Element : sel.anchorNode.parentElement)?.closest('a') : null;
    const url = window.prompt('Link URL (empty to remove)', anchor?.getAttribute('href') ?? 'https://');
    if (url === null) { a.el.focus(); return; }
    if (!url) this.exec('unlink'); else this.exec('createLink', url);
  }

  private mountToolbar(el: HTMLElement) {
    const doc = el.ownerDocument;
    const tb = doc.createElement('div');
    tb.setAttribute('data-ase-toolbar', '');
    tb.className = 'ase-rt';
    tb.innerHTML = '<button type="button" data-cmd="bold" title="Bold (⌘B)"><b>B</b></button><button type="button" data-cmd="italic" title="Italic (⌘I)"><i>I</i></button><button type="button" data-cmd="link" title="Link (⌘K)">🔗</button><button type="button" data-cmd="removeFormat" title="Clear formatting">Tx</button><span class="ase-rt__hint">Esc cancels</span>';
    tb.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
    tb.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const cmd = b.dataset.cmd!;
      if (cmd === 'link') this.link(); else this.exec(cmd);
    });
    doc.body.append(tb);
    const r = el.getBoundingClientRect();
    tb.style.top = `${Math.max(4, r.top + doc.defaultView!.scrollY - 40)}px`;
    tb.style.left = `${Math.max(4, r.left + doc.defaultView!.scrollX)}px`;
    this.active!.toolbar = tb;
  }
}
