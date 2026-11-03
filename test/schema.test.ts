import { describe, expect, it } from 'vitest';
import { allowedChildTypes, createNode, defaultSettings, formModel, inlineFields, nodeLabel, serializeRegistry, validateDoc } from '../src/core/schema';
import type { SchemaRegistry } from '../src/runtime';

const reg: SchemaRegistry = {
  container: { label: 'Container', fields: { padding: { type: 'text', label: 'Padding', default: '0', group: 'style' }, html: { type: 'code', label: 'HTML', group: 'advanced' } }, blocks: '*' },
  heading: { label: 'Heading', fields: { text: { type: 'text', label: 'Text', inline: true, default: 'Heading' }, tag: { type: 'select', label: 'Tag', options: [{ value: 'h2', label: 'H2' }], default: 'h2', group: 'advanced' } } },
  text: { label: 'Text', fields: { html: { type: 'richtext', label: 'Content', inline: true } } },
  gallery: { label: 'Gallery', fields: {}, blocks: ['gallery-item', 'missing-type'] },
  'gallery-item': { label: 'Gallery image', fields: { image: { type: 'image', label: 'Image', inline: true } }, hidden: true },
};

describe('formModel', () => {
  it('groups fields and fills defaults, current values win', () => {
    const groups = formModel(reg.container, { padding: '8px' });
    expect(groups.map((g) => g.name)).toEqual(['style', 'advanced']);
    expect(groups[0].label).toBe('Style');
    expect(groups[0].fields[0]).toMatchObject({ name: 'padding', value: '8px' });
    expect(groups[1].fields[0]).toMatchObject({ name: 'html', value: undefined });
    expect(formModel(reg.heading)[0].fields[0].value).toBe('Heading');
  });
  it('returns no groups for a schema without fields', () => {
    expect(formModel(reg.gallery)).toEqual([]);
  });
});

describe('node factories', () => {
  it('defaultSettings copies defaults only', () => {
    expect(defaultSettings(reg.heading)).toEqual({ text: 'Heading', tag: 'h2' });
    expect(defaultSettings(reg.text)).toEqual({});
  });
  it('createNode applies defaults, overrides and an empty blocks list for parents', () => {
    const n = createNode('heading', reg, { text: 'Hi' });
    expect(n.settings).toEqual({ text: 'Hi', tag: 'h2' });
    expect(n.id).toMatch(/^[0-9a-f]{7}$/);
    expect(n.blocks).toBeUndefined();
    expect(createNode('container', reg).blocks).toEqual([]);
    expect(() => createNode('nope', reg)).toThrow(/unknown block type/);
  });
  it('allowedChildTypes', () => {
    expect(allowedChildTypes('container', reg)).toEqual(['container', 'heading', 'text', 'gallery']);
    expect(allowedChildTypes('gallery', reg)).toEqual(['gallery-item']);
    expect(allowedChildTypes('heading', reg)).toBeNull();
  });
  it('inlineFields', () => {
    expect(inlineFields(reg.heading)).toEqual(['text']);
    expect(inlineFields(reg.container)).toEqual([]);
  });
});

describe('validateDoc', () => {
  const ok = { title: 'T', sections: [{ id: 'a', type: 'container', settings: {}, blocks: [{ id: 'b', type: 'heading', settings: {} }, { id: 'g', type: 'gallery', settings: {}, blocks: [{ id: 'gi', type: 'gallery-item', settings: {} }] }] }] };
  it('accepts a valid document', () => expect(validateDoc(ok, reg)).toEqual([]));
  it('reports structural problems', () => {
    expect(validateDoc(null, reg)).toEqual(['document is not an object']);
    expect(validateDoc({ title: 1, sections: 'x' }, reg)).toEqual(['title must be a string', 'sections must be an array']);
  });
  it('reports duplicate ids, unknown types and disallowed children', () => {
    const bad = { title: 'T', sections: [
      { id: 'a', type: 'container', settings: {}, blocks: [{ id: 'a', type: 'heading', settings: {} }] },
      { id: 'c', type: 'widget', settings: {} },
      { id: 'g', type: 'gallery', settings: {}, blocks: [{ id: 'h', type: 'heading', settings: {} }] },
      { id: 'n', type: 'heading' },
    ] };
    const errors = validateDoc(bad, reg);
    expect(errors).toContain('sections.0.blocks.0: duplicate id a');
    expect(errors).toContain('sections.1: unknown type "widget"');
    expect(errors).toContain('sections.2.blocks.0: gallery does not accept heading');
    expect(errors).toContain('sections.3: settings must be an object');
  });
});

describe('serializeRegistry / nodeLabel', () => {
  it('strips components', () => {
    const out = serializeRegistry({ heading: { ...reg.heading, component: () => 'x' } } as any);
    expect((out.heading as any).component).toBeUndefined();
    expect(out.heading.label).toBe('Heading');
  });
  it('labels nodes from inline text, falling back through nested blocks', () => {
    expect(nodeLabel({ id: '1', type: 'heading', settings: { text: 'Welcome home' } }, reg)).toBe('Heading: Welcome home');
    expect(nodeLabel({ id: '1', type: 'text', settings: { html: '<p>Some <b>rich</b>   text</p>' } }, reg)).toBe('Text: Some rich text');
    expect(nodeLabel({ id: '1', type: 'heading', settings: { text: 'x'.repeat(50) } }, reg)).toBe(`Heading: ${'x'.repeat(35)}…`);
    const section = { id: 's', type: 'container', settings: { padding: '80px 0' }, blocks: [{ id: 'i', type: 'container', settings: {}, blocks: [{ id: 't', type: 'text', settings: { html: 'Body' } }, { id: 'h', type: 'heading', settings: { text: 'Title' } }] }] };
    expect(nodeLabel(section, reg)).toBe('Container · Title');
    expect(nodeLabel({ id: 'e', type: 'container', settings: {} }, reg)).toBe('Container');
    expect(nodeLabel({ id: 'u', type: 'mystery', settings: {} }, reg)).toBe('mystery');
  });
});
