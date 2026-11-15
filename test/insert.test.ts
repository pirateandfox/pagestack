import { describe, expect, it } from 'vitest';
import { groupItems, insertItems, insertTarget, searchItems } from '../src/core/insert';
import type { SchemaRegistry } from '../src/runtime';

const registry: SchemaRegistry = {
  hero: { label: 'Hero', description: 'Big photo', fields: {}, blocks: ['button'] },
  cards: { label: 'Cards', fields: {}, blocks: ['card'] },
  card: { label: 'Card', hidden: true, fields: {} },
  box: { label: 'Box', fields: {}, blocks: '*' },
  button: { label: 'Button', keywords: ['cta', 'link'], fields: {} },
  heading: { label: 'Heading', category: 'Text', fields: {} },
};
const node = (type: string) => ({ id: 'x', type, settings: {} });
const presets = [{ label: 'Hero', description: 'd', node: node('hero') }, { label: 'Cards', node: node('cards') }];

describe('insertItems', () => {
  it('top level: presets, then containers', () => {
    const items = insertItems(null, registry, presets);
    expect(items.map((i) => [i.label, i.category])).toEqual([['Hero', 'Sections'], ['Cards', 'Sections'], ['Box', 'Layout']]);
    expect(items[0].node?.type).toBe('hero');
    expect(items[2].type).toBe('box');
  });
  it('top level without presets: every visible type', () => {
    expect(insertItems(null, registry, []).map((i) => i.type)).toEqual(['hero', 'cards', 'box', 'button', 'heading']);
  });
  it('inside a parent: only what it accepts', () => {
    expect(insertItems('hero', registry, presets).map((i) => i.type)).toEqual(['button']);
    expect(insertItems('cards', registry, presets).map((i) => i.type)).toEqual(['card']); // hidden items are fine where declared
    expect(insertItems('heading', registry, presets)).toEqual([]);
  });
  it('a free-form container offers blocks and ready-made sections', () => {
    const items = insertItems('box', registry, presets);
    expect(items.map((i) => i.type ?? `preset ${i.node!.type}`)).toEqual(['hero', 'cards', 'box', 'button', 'heading', 'preset hero', 'preset cards']);
  });
  it('saved patterns come first and only where they fit', () => {
    const saved = [{ id: 'p1', label: 'My button', node: node('button') }, { id: 'p2', label: 'My hero', node: node('hero') }];
    expect(insertItems('hero', registry, [], saved).map((i) => i.label)).toEqual(['My button', 'Button']);
    expect(insertItems(null, registry, presets, saved)[0].savedId).toBe('p1');
    expect(insertItems('cards', registry, [], saved).map((i) => i.label)).toEqual(['Card']);
  });
});

describe('searchItems', () => {
  const items = insertItems('box', registry, []);
  it('matches label, description and keywords', () => {
    expect(searchItems(items, 'head').map((i) => i.label)).toEqual(['Heading']);
    expect(searchItems(items, 'big photo').map((i) => i.label)).toEqual(['Hero']);
    expect(searchItems(items, 'CTA').map((i) => i.label)).toEqual(['Button']);
    expect(searchItems(items, 'nothing here')).toEqual([]);
  });
  it('blank query returns everything; label starts rank first', () => {
    expect(searchItems(items, '  ')).toHaveLength(items.length);
    const ranked = searchItems([{ key: 'a', label: 'Zed', description: 'a box', category: '', keywords: [] }, { key: 'b', label: 'Box', category: '', keywords: [] }], 'box');
    expect(ranked[0].label).toBe('Box');
  });
});

it('groupItems keeps first-seen category order', () => {
  expect(groupItems(insertItems('box', registry, [])).map((g) => g.category)).toEqual(['Blocks', 'Text']);
});

describe('insertTarget', () => {
  const doc = { sections: [{ ...node('hero'), blocks: [node('button')] }, node('box'), node('heading')] };
  it('nothing selected: the end of the page', () => {
    expect(insertTarget(doc, null)).toEqual({ listPath: 'sections', index: 3 });
  });
  it('a container selected: after it, not inside it', () => {
    expect(insertTarget(doc, 'sections.1')).toEqual({ listPath: 'sections', index: 2 });
    expect(insertTarget(doc, 'sections.0')).toEqual({ listPath: 'sections', index: 1 });
  });
  it('a child selected: after it, in its parent', () => {
    expect(insertTarget(doc, 'sections.0.blocks.0')).toEqual({ listPath: 'sections.0.blocks', index: 1 });
  });
});
