import { describe, expect, it } from 'vitest';
import { askedOnAdd, fillRequired, missingFields, missingInPage, missingMessage, newItemData } from '../src/core/required';
import type { Field, PageDoc, SchemaRegistry } from '../src/runtime';

const need = (f: Partial<Field> & { type: Field['type'] }): Field => ({ label: 'F', required: true, ...f });
const blank = (f: Partial<Field> & { type: Field['type'] }, v?: unknown) => missingFields({ f: need(f) }, v === undefined ? {} : { f: v }).length === 1;

describe('what counts as filled in', () => {
  it('by type', () => {
    for (const type of ['text', 'richtext', 'textarea', 'link', 'date', 'number', 'image', 'tags', 'list', 'multiselect', 'svg', 'code', 'color'] as const) {
      expect(blank({ type }), type).toBe(true);
      expect(blank({ type }, ''), type).toBe(true);
      expect(blank({ type }, null), type).toBe(true);
    }
    expect(blank({ type: 'text' }, '  ')).toBe(true);
    expect(blank({ type: 'number' }, 0)).toBe(false);
    expect(blank({ type: 'richtext' }, '<p><br>&nbsp;</p>')).toBe(true);
    expect(blank({ type: 'richtext' }, '<p><img src="/a.png"></p>')).toBe(false);
    expect(blank({ type: 'text', marks: true }, '<em></em>')).toBe(true);
    expect(blank({ type: 'image' }, { src: '', alt: 'x' })).toBe(true);
    expect(blank({ type: 'image' }, { src: '/a.png', alt: '' })).toBe(false);
    expect(blank({ type: 'image', asUrl: true }, '/a.png')).toBe(false);
    expect(blank({ type: 'tags' }, [' '])).toBe(true);
    expect(blank({ type: 'multiselect' }, ['a'])).toBe(false);
    expect(blank({ type: 'multiselect' }, 'a')).toBe(false); // hand-written
    expect(blank({ type: 'boolean' })).toBe(false);
  });

  it('what the form displays with nothing stored', () => {
    const options = [{ value: 'a', label: 'A' }];
    expect(blank({ type: 'select', options })).toBe(false);
    expect(blank({ type: 'select', options: [{ value: '', label: 'None' }, ...options] })).toBe(true);
    expect(blank({ type: 'text', default: 'x' })).toBe(false);
    expect(blank({ type: 'text', default: 'x' }, '')).toBe(true); // cleared on purpose
    expect(fillRequired({ s: need({ type: 'select', options }), t: { type: 'text', label: 'T', default: 'not required' }, c: need({ type: 'text', default: 'x' }) }, { c: '' })).toEqual({ s: 'a', c: '' });
  });

  it('not while showIf hides it', () => {
    const fields = { kind: { type: 'text', label: 'Kind' } as Field, until: need({ type: 'date', showIf: { field: 'kind', is: 'weekly' } }) };
    expect(missingFields(fields, {})).toEqual([]);
    expect(missingFields(fields, { kind: 'weekly' })).toMatchObject([{ path: ['until'] }]);
    expect(fillRequired({ ...fields, until: { ...fields.until, default: '2026-01-01' } }, {})).toEqual({});
  });

  it('in list rows, whether or not the list itself is required', () => {
    const fields: Record<string, Field> = { links: { type: 'list', label: 'Links', fields: { url: need({ type: 'link', label: 'URL' }), kind: need({ type: 'select', label: 'Kind', options: [{ value: 'a', label: 'A' }] }) } } };
    expect(missingFields(fields, { links: [{ url: '/a' }, {}] })).toEqual([{ path: ['links', 1, 'url'], label: 'Links, item 2: URL' }]);
    expect(missingFields(fields, {})).toEqual([]);
    expect(fillRequired(fields, { links: [{ url: '/a' }] })).toEqual({ links: [{ url: '/a', kind: 'a' }] });
  });
});

it('says what is missing, briefly', () => {
  const m = (...labels: string[]) => missingMessage(labels.map((label) => ({ path: [], label })));
  expect(m('Year')).toBe('Fill in Year.');
  expect(m('Date', 'Year', 'Short title')).toBe('Fill in Date, Year and Short title.');
  expect(m('A', 'B', 'C', 'D', 'E', 'F')).toBe('Fill in A, B, C and 3 more.');
});

describe('new items', () => {
  const fields: Record<string, Field> = {
    title: need({ type: 'text', label: 'Title' }), date: need({ type: 'date', label: 'Date', time: false }), modified: need({ type: 'date', label: 'Modified' }),
    year: need({ type: 'number', label: 'Year' }), by: need({ type: 'text', label: 'By', default: 'Us' }), note: { type: 'text', label: 'Note' }, draft: { type: 'boolean', label: 'Draft' },
  };
  it('start from the defaults, today, and a draft', () => {
    expect(newItemData(fields, new Date('2026-11-24T10:00:00Z'))).toEqual({ date: '2026-11-24', by: 'Us', draft: true });
  });
  it('take today from the editor’s clock, not the server’s UTC one', () => {
    const at = { title: fields.title, start: need({ type: 'date', label: 'Start' }) };
    expect(newItemData(at, '2026-11-24T18:49:35')).toEqual({ start: '2026-11-24T18:49:35' });
    expect(newItemData(fields, '2026-11-24T23:30:00').date).toBe('2026-11-24');
    expect(newItemData(at, 'tomorrow').start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it('ask only for what those leave empty', () => {
    expect(Object.keys(askedOnAdd(fields))).toEqual(['modified', 'year']);
    // Fields an answer can bring up come along; the sidebar's closed group doesn't hide any.
    const asked = askedOnAdd({ kind: need({ type: 'text', group: 'advanced' }), until: need({ type: 'date', showIf: { field: 'kind', is: 'weekly' } }), day: { type: 'date', label: 'D' }, other: need({ type: 'text', showIf: { field: 'draft' } }), draft: { type: 'boolean', label: 'Draft', default: false } });
    expect(Object.keys(asked)).toEqual(['kind', 'other']);
    expect(asked.kind.group).toBeUndefined();
    const chain = askedOnAdd({ kind: need({ type: 'text' }), on: { type: 'date', label: 'On' }, until: need({ type: 'number', showIf: { field: 'kind', is: 'weekly' } }) });
    expect(Object.keys(chain)).toEqual(['kind', 'until']);
    expect(askedOnAdd({ title: need({ type: 'text' }), tags: { type: 'tags', label: 'Tags' } })).toEqual({});
  });
});

describe('pages', () => {
  const registry: SchemaRegistry = { row: { label: 'Row', fields: {}, blocks: '*' }, hero: { label: 'Hero', fields: { title: need({ type: 'text', label: 'Title' }) } } };
  const page: PageDoc = { title: 'P', layout: {}, sections: [{ id: '1', type: 'row', settings: {}, blocks: [{ id: '2', type: 'hero', settings: { title: 'ok' } }, { id: '3', type: 'hero', settings: {} }] }] };
  it('name the block and where it is', () => {
    expect(missingInPage(page, registry, { theme: need({ type: 'text', label: 'Theme' }) })).toEqual([
      { path: ['theme'], label: 'Theme', node: null },
      { path: ['title'], label: 'Hero: Title', node: 'sections.0.blocks.1' },
    ]);
  });
  it('may be incomplete while they are drafts', () => {
    expect(missingInPage({ ...page, status: 'draft' }, registry, {})).toEqual([]);
  });
});
