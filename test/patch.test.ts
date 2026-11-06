import { describe, expect, it } from 'vitest';
import { childListPath, getAt, insertNode, isNodePath, moveNode, nodePathOf, pathOfId, removeNode, replaceNode, setAt, splitNodePath, updateSettings, walk } from '../src/core/patch';
import type { PageDoc } from '../src/runtime';

const doc = (): PageDoc => ({
  title: 'T',
  sections: [
    { id: 'a', type: 'container', settings: {}, blocks: [{ id: 'a1', type: 'heading', settings: { text: 'Hello' } }, { id: 'a2', type: 'text', settings: { html: '<p>x</p>' } }] },
    { id: 'b', type: 'container', settings: { backgroundColor: '#fff' }, blocks: [] },
    { id: 'c', type: 'container', settings: {} },
  ],
});
const ids = (d: PageDoc, list = 'sections') => (getAt(d, list) as any[]).map((n) => n.id);

describe('paths', () => {
  it('reads nested values', () => {
    expect(getAt(doc(), 'sections.0.blocks.1.settings.html')).toBe('<p>x</p>');
    expect(getAt(doc(), 'sections.9.blocks.0')).toBeUndefined();
  });
  it('setAt returns a new document and leaves the input alone', () => {
    const d = doc();
    const next = setAt(d, 'sections.0.blocks.0.settings.text', 'Bye');
    expect(getAt(next, 'sections.0.blocks.0.settings.text')).toBe('Bye');
    expect(getAt(d, 'sections.0.blocks.0.settings.text')).toBe('Hello');
    expect(next).not.toBe(d);
  });
  it('recognises node paths', () => {
    expect(isNodePath('sections.0')).toBe(true);
    expect(isNodePath('sections.0.blocks.3.blocks.1')).toBe(true);
    expect(isNodePath('sections.0.settings.text')).toBe(false);
    expect(isNodePath('sections')).toBe(false);
    expect(nodePathOf('sections.2.blocks.0.settings.heading')).toBe('sections.2.blocks.0');
    expect(splitNodePath('sections.2.blocks.0')).toEqual({ listPath: 'sections.2.blocks', index: 0 });
    expect(childListPath(null)).toBe('sections');
    expect(childListPath('sections.1')).toBe('sections.1.blocks');
  });
});

describe('mutations', () => {
  it('updateSettings merges a patch', () => {
    const d = doc();
    const next = updateSettings(d, 'sections.1', { padding: '10px' });
    expect(next.sections[1].settings).toEqual({ backgroundColor: '#fff', padding: '10px' });
    expect(d.sections[1].settings).toEqual({ backgroundColor: '#fff' });
  });
  it('insertNode clamps the index and creates a missing blocks list', () => {
    const n = { id: 'z', type: 'heading', settings: {} };
    expect(ids(insertNode(doc(), 'sections', 1, n))).toEqual(['a', 'z', 'b', 'c']);
    expect(ids(insertNode(doc(), 'sections', 99, n))).toEqual(['a', 'b', 'c', 'z']);
    expect(ids(insertNode(doc(), 'sections', -5, n))).toEqual(['z', 'a', 'b', 'c']);
    expect(ids(insertNode(doc(), 'sections.2.blocks', 0, n), 'sections.2.blocks')).toEqual(['z']);
  });
  it('removeNode', () => {
    expect(ids(removeNode(doc(), 'sections.1'))).toEqual(['a', 'c']);
    expect(ids(removeNode(doc(), 'sections.0.blocks.0'), 'sections.0.blocks')).toEqual(['a2']);
  });
  it('moveNode uses the final index (what a sortable reports)', () => {
    expect(ids(moveNode(doc(), 'sections.0', 'sections', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveNode(doc(), 'sections.0', 'sections', 1))).toEqual(['b', 'a', 'c']);
    expect(ids(moveNode(doc(), 'sections.2', 'sections', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveNode(doc(), 'sections.1', 'sections', 1))).toEqual(['a', 'b', 'c']);
  });
  it('moveNode across lists', () => {
    const next = moveNode(doc(), 'sections.0.blocks.1', 'sections.1.blocks', 0);
    expect(ids(next, 'sections.0.blocks')).toEqual(['a1']);
    expect(ids(next, 'sections.1.blocks')).toEqual(['a2']);
    const intoEmpty = moveNode(doc(), 'sections.0.blocks.0', 'sections.2.blocks', 0);
    expect(ids(intoEmpty, 'sections.2.blocks')).toEqual(['a1']);
  });
  it('refuses to move a node into itself', () => {
    expect(() => moveNode(doc(), 'sections.0', 'sections.0.blocks', 0)).toThrow(/into itself/);
  });
  it('replaceNode', () => {
    const next = replaceNode(doc(), 'sections.0.blocks.0', { id: 'n', type: 'text', settings: {} });
    expect(ids(next, 'sections.0.blocks')).toEqual(['n', 'a2']);
  });
});

describe('walk / pathOfId', () => {
  it('visits depth-first with paths and depths', () => {
    expect([...walk(doc())].map((w) => `${w.path}:${w.node.id}:${w.depth}`)).toEqual(['sections.0:a:0', 'sections.0.blocks.0:a1:1', 'sections.0.blocks.1:a2:1', 'sections.1:b:0', 'sections.2:c:0']);
    expect(pathOfId(doc(), 'a2')).toBe('sections.0.blocks.1');
    expect(pathOfId(doc(), 'nope')).toBeUndefined();
  });
});

describe('moveNode into a later sibling', () => {
  it('lands in the intended node even though removal shifts its path', () => {
    const d = moveNode(doc(), 'sections.0', 'sections.1.blocks', 0);
    expect(ids(d)).toEqual(['b', 'c']);
    expect(ids(d, 'sections.0.blocks')).toEqual(['a']);
  });
  it('moves a block out to the page level', () => {
    const d = moveNode(doc(), 'sections.0.blocks.1', 'sections', 3);
    expect(ids(d)).toEqual(['a', 'b', 'c', 'a2']);
    expect(ids(d, 'sections.0.blocks')).toEqual(['a1']);
  });
  it('creates the list on a node that has none yet', () => {
    expect(ids(moveNode(doc(), 'sections.0.blocks.0', 'sections.2.blocks', 0), 'sections.2.blocks')).toEqual(['a1']);
  });
});
