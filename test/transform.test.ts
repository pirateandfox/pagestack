import { describe, expect, it } from 'vitest';
import { transformNode, transformTargets } from '../src/core/transform';
import { applySynced } from '../src/core/synced';
import { parseMarkdown, writeMarkdown } from '../src/core/frontmatter';
import { sanitizeMarkdown } from '../src/core/sanitize';
import type { SchemaRegistry } from '../src/runtime';

const registry: SchemaRegistry = {
  heading: { label: 'Heading', fields: { text: { type: 'text', label: 'T' }, tag: { type: 'select', label: 'Tag', default: 'h2', options: [{ value: 'h2', label: '' }] } } },
  prose: { label: 'Prose', fields: { html: { type: 'richtext', label: 'H' } } },
  image: { label: 'Image', fields: { image: { type: 'image', label: 'I' } } },
  box: { label: 'Box', blocks: ['heading'], fields: { title: { type: 'text', label: 'T' } } },
  item: { label: 'Item', hidden: true, fields: { text: { type: 'text', label: 'T' } } },
};

describe('block transforms', () => {
  const heading = { id: 'a', type: 'heading', settings: { text: 'Hi <em>there</em>', tag: 'h2' } };
  it('offers what the content fits, never hidden types', () => {
    const t = transformTargets(heading, null, registry).map((x) => x.type);
    expect(t).toContain('prose'); expect(t).toContain('box');
    expect(t).not.toContain('image'); expect(t).not.toContain('item');
  });
  it('respects where the block sits and an explicit list', () => {
    expect(transformTargets(heading, 'box', registry)).toEqual([]);
    expect(transformTargets(heading, null, { ...registry, heading: { ...registry.heading, transforms: ['box'] } }).map((x) => x.type)).toEqual(['box']);
  });
  it('offers nothing for an empty block', () => expect(transformTargets({ id: 'a', type: 'heading', settings: {} }, null, registry)).toEqual([]));
  it('carries text between plain and rich, keeping the id', () => {
    const rich = transformNode(heading, 'prose', registry);
    expect(rich).toMatchObject({ id: 'a', type: 'prose', settings: { html: '<p>Hi <em>there</em></p>' } });
    expect(transformNode(rich, 'heading', registry).settings).toEqual({ text: 'Hi <em>there</em>', tag: 'h2' });
  });
  it('keeps children only where they are allowed, and gives containers a list', () => {
    expect(transformNode(heading, 'box', registry).blocks).toEqual([]);
    const full = { id: 'b', type: 'box', settings: { title: 'x' }, blocks: [heading] };
    expect(transformTargets(full, null, registry).map((x) => x.type)).toEqual([]);
  });
});

describe('synced patterns', () => {
  const source = { id: 'src', type: 'box', settings: { title: 'New' }, blocks: [{ id: 'k', type: 'heading', settings: { text: 'K' } }] };
  const doc = { title: 't', sections: [{ id: 'one', type: 'box', settings: { title: 'Old' }, synced: 'p1', blocks: [] }, { id: 'two', type: 'box', settings: { title: 'Other' }, blocks: [{ id: 'three', type: 'box', settings: {}, synced: 'p1' }] }, { id: 'four', type: 'box', settings: {}, synced: 'p2' }] } as any;
  it('updates every copy at any depth, and only those', () => {
    const { doc: out, changed } = applySynced(doc, 'p1', source);
    expect(changed).toBe(true);
    expect(out.sections[0]).toMatchObject({ id: 'one', synced: 'p1', settings: { title: 'New' } });
    expect(out.sections[1].blocks![0]).toMatchObject({ id: 'three', settings: { title: 'New' } });
    expect(out.sections[1].settings.title).toBe('Other');
    expect(out.sections[2].settings).toEqual({});
  });
  it('gives each copy its own child ids, so two copies on a page stay valid', () => {
    const { doc: out } = applySynced(doc, 'p1', source);
    expect(out.sections[0].blocks![0].id).not.toBe('k');
    expect(out.sections[0].blocks![0].id).not.toBe(out.sections[1].blocks![0].blocks![0].id);
  });
  it('reports nothing changed on a page without copies', () => expect(applySynced({ title: 't', sections: [] }, 'p1', source).changed).toBe(false));
});

describe('frontmatter', () => {
  const raw = `---\ntitle: "A: B"\ndate: "2025-03-07T09:49:39"\ncategories: ["Climate Action"]\n# keep me\ncustom: yes\n---\n\n## Hello\n\nBody.\n`;
  it('reads values and the exact body', () => {
    const { data, body } = parseMarkdown(raw);
    expect(data).toMatchObject({ title: 'A: B', categories: ['Climate Action'] });
    expect(typeof data.date).toBe('string');
    expect(body).toBe('\n## Hello\n\nBody.\n');
  });
  it('writes nothing new when nothing changed', () => { const { data, body } = parseMarkdown(raw); expect(writeMarkdown(raw, data, body)).toBe(raw); });
  it('changes one value and leaves the rest of the header alone', () => {
    const out = writeMarkdown(raw, { title: 'New' }, 'x');
    expect(out).toContain('title: New');
    expect(out).toContain('date: "2025-03-07T09:49:39"');
    expect(out).toContain('categories: ["Climate Action"]');
    expect(out).toContain('# keep me');
    expect(out.endsWith('---\nx')).toBe(true);
  });
  it('creates a file from nothing', () => expect(parseMarkdown(writeMarkdown(null, { title: 'T', draft: true }, '\n')).data).toEqual({ title: 'T', draft: true }));
});

describe('sanitizeMarkdown', () => {
  it('removes script and unsafe links', () => {
    const out = sanitizeMarkdown('Hi <img src=x onerror=alert(1)> <script>x()</script>\n\n[a](javascript:alert(1)) [ok](/fine/)\n\n[r]: javascript:alert(2)\n');
    expect(out).not.toMatch(/onerror|<script|javascript:/);
    expect(out).toContain('[ok](/fine/)');
  });
  it('leaves code samples, autolinks and ordinary Markdown alone', () => {
    const md = '# T\n\n> quote\n\n`<script>` inline\n\n```html\n<script>sample()</script>\n```\n\n<https://example.com> and **bold** [l](https://x.co "t")\n';
    expect(sanitizeMarkdown(md)).toBe(md);
  });
});

describe('transformNode carries a multiselect across', () => {
  const opts = (...v: string[]) => v.map((value) => ({ value, label: value }));
  const text = { type: 'text' as const, label: 'T' };
  const reg: SchemaRegistry = {
    a: { label: 'A', fields: { t: text, days: { type: 'multiselect', label: 'D', options: opts('mon', 'tue') } } },
    same: { label: 'S', fields: { t: text, days: { type: 'multiselect', label: 'D', options: opts('mon', 'tue', 'wed') } } },
    fewer: { label: 'F', fields: { t: text, days: { type: 'multiselect', label: 'D', options: opts('mon') } } },
  };
  const node = { id: '1', type: 'a', settings: { t: 'x', days: ['mon', 'tue'] } };
  it('when every value is offered there', () => {
    expect(transformNode(node, 'same', reg).settings.days).toEqual(['mon', 'tue']);
    expect(transformNode(node, 'fewer', reg).settings.days).toBeUndefined();
  });
});
