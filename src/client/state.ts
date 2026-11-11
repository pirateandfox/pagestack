// Draft state: the working document, undo/redo history and localStorage persistence so a
// refresh doesn't lose unsaved work.
import type { PageDoc } from '../runtime';

export type ChangeSource = 'edit' | 'field' | 'inline' | 'undo' | 'redo' | 'restore' | 'save' | 'reset';

export class EditorState extends EventTarget {
  doc: PageDoc;
  /** Hash of the stored file this draft is based on (optimistic concurrency for saves). */
  hash: string;
  private savedJson: string;
  private past: string[] = [];
  private future: string[] = [];
  private key: string;

  constructor(public slug: string, doc: PageDoc, hash: string) {
    super();
    this.doc = doc;
    this.hash = hash;
    this.savedJson = JSON.stringify(doc);
    this.key = `ps:draft:${slug}`;
  }

  get dirty() { return JSON.stringify(this.doc) !== this.savedJson; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** Replace the document. `record` pushes an undo step (default). */
  apply(next: PageDoc, source: ChangeSource = 'edit', record = true) {
    if (record) this.snapshot();
    this.doc = next;
    this.persist();
    this.emit(source);
  }
  /** Push an undo step without changing the doc (used before a run of silent inline edits). */
  snapshot() {
    this.past.push(JSON.stringify(this.doc));
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }
  /** Take back a `snapshot` that turned out to have no change after it. */
  dropSnapshot() { this.past.pop(); }
  undo() {
    const prev = this.past.pop();
    if (prev === undefined) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev);
    this.persist();
    this.emit('undo');
  }
  redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next);
    this.persist();
    this.emit('redo');
  }
  markSaved(hash: string) {
    this.hash = hash;
    this.savedJson = JSON.stringify(this.doc);
    this.clearDraft();
    this.emit('save');
  }
  /** Throw away the draft and go back to the stored page. */
  reset(doc: PageDoc, hash: string) {
    this.doc = doc; this.hash = hash; this.savedJson = JSON.stringify(doc);
    this.past = []; this.future = [];
    this.clearDraft();
    this.emit('reset');
  }

  private emit(source: ChangeSource) { this.dispatchEvent(new CustomEvent('change', { detail: { source } })); }

  private persist() {
    try { if (this.dirty) localStorage.setItem(this.key, JSON.stringify({ base: this.hash, doc: this.doc, at: Date.now() })); else localStorage.removeItem(this.key); } catch { /* private mode etc. */ }
  }
  clearDraft() { try { localStorage.removeItem(this.key); } catch { /* ignore */ } }

  /** A draft saved earlier for this page, if it was based on the same stored version. */
  static restore(slug: string, hash: string): { doc: PageDoc; at: number } | null | 'stale' {
    try {
      const raw = localStorage.getItem(`ps:draft:${slug}`);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.base !== hash) return 'stale';
      return { doc: d.doc, at: d.at };
    } catch { return null; }
  }
}
