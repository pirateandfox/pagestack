// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '../src/client/state';
import { taskQueue } from '../src/client/ui';
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

describe('edits made while a save runs', () => {
  it('are still to be saved, and recoverable on top of the saved version', () => {
    const s = new EditorState('home', page('Hello'), 'h1');
    s.apply(page('One'));
    const sent = s.doc;
    s.apply(page('One two'), 'field');
    s.markSaved('h2', sent);
    expect(s.dirty).toBe(true);
    expect(EditorState.restore('home', 'h2')).toMatchObject({ doc: { title: 'One two' } });
    s.markSaved('h3', s.doc);
    expect(s.dirty).toBe(false);
    expect(EditorState.restore('home', 'h3')).toBeNull();
  });
});

describe('taskQueue', () => {
  it('runs one at a time, in order, and carries on after a failure', async () => {
    const queued = taskQueue();
    const log: string[] = [];
    let release!: () => void;
    const first = queued(async () => { log.push('1 starts'); await new Promise<void>((r) => { release = r; }); log.push('1 ends'); throw new Error('no'); });
    const second = queued(async () => { log.push('2'); return 2; });
    await Promise.resolve();
    release();
    await expect(first).rejects.toThrow('no');
    expect(await second).toBe(2);
    expect(log).toEqual(['1 starts', '1 ends', '2']);
  });
});
