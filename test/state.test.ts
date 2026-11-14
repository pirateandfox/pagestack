// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '../src/client/state';
import type { PageDoc } from '../src/runtime';

const page = (title: string): PageDoc => ({ title, sections: [{ id: 'a', type: 'hero', settings: { title } }] });

describe('cancelling an inline edit', () => {
  it('Escape after live updates puts the document back, so nothing is left to save', () => {
    const s = new EditorState('home', page('Hello'), 'h');
    s.snapshot(); // the edit starts
    s.apply(page('Hel'), 'inline', false); // live updates while typing
    s.apply(page('Help'), 'inline', false);
    expect(s.dirty).toBe(true);
    expect(s.dropSnapshot(true)).toBe(true);
    expect(s.doc.title).toBe('Hello');
    expect(s.dirty).toBe(false);
    expect(s.canUndo).toBe(false);
  });
  it('clicking in and out changes nothing', () => {
    const s = new EditorState('home', page('Hello'), 'h');
    s.snapshot();
    expect(s.dropSnapshot(true)).toBe(false);
    expect(s.dirty).toBe(false);
    expect(s.canUndo).toBe(false);
  });
});
