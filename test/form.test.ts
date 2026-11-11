// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderForm } from '../src/client/form';
import type { BlockSchema } from '../src/runtime';

const schema: BlockSchema = {
  label: 'Demo',
  fields: {
    title: { type: 'text', label: 'Title', inline: true },
    href: { type: 'link', label: 'Link' },
    body: { type: 'richtext', label: 'Body', inline: true },
    count: { type: 'number', label: 'Count', min: 0, max: 10 },
    on: { type: 'boolean', label: 'Enabled' },
    size: { type: 'select', label: 'Size', options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }], default: 's', group: 'style' },
    color: { type: 'color', label: 'Colour', group: 'style' },
    image: { type: 'image', label: 'Image', inline: true },
    icon: { type: 'svg', label: 'Icon', icons: ['star', 'arrow'], group: 'advanced' },
  },
};
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('renderForm', () => {
  it('renders one widget per field, grouped, with current values', () => {
    const root = document.createElement('div');
    renderForm(root, schema, { title: 'Hello', count: 3, on: true, size: 'l', color: '#ff0000', image: { src: '/a.png', alt: 'A' }, icon: 'star' }, { onChange: vi.fn(), pickImage: vi.fn() });
    expect([...root.querySelectorAll('details > summary')].map((s) => s.textContent)).toEqual(['Content', 'Style', 'Advanced']);
    expect((root.querySelector('#ps-f-title') as HTMLInputElement).value).toBe('Hello');
    expect((root.querySelector('#ps-f-count') as HTMLInputElement).value).toBe('3');
    expect((root.querySelector('#ps-f-on') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#ps-f-size') as HTMLSelectElement).value).toBe('l');
    expect((root.querySelector('#ps-f-color') as HTMLInputElement).value).toBe('#ff0000');
    expect((root.querySelector('.ps-field--color input[type=color]') as HTMLInputElement).value).toBe('#ff0000');
    expect(root.querySelector('.ps-thumb img')?.getAttribute('src')).toBe('/a.png');
    expect((root.querySelector('.ps-field--image input[aria-label="Alt text"]') as HTMLInputElement).value).toBe('A');
    expect((root.querySelector('#ps-f-icon') as HTMLSelectElement).value).toBe('star');
    expect(root.querySelector('.ps-field--body, .ps-field--richtext textarea')).toBeTruthy();
    expect((root.querySelector('details.ps-group:last-of-type') as HTMLDetailsElement).open).toBe(false); // advanced collapsed
  });

  it('reports changes with the field name and a typed value', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    renderForm(root, schema, {}, { onChange, pickImage: vi.fn() });
    const title = root.querySelector('#ps-f-title') as HTMLInputElement; title.value = 'New'; fire(title, 'change');
    const count = root.querySelector('#ps-f-count') as HTMLInputElement; count.value = '7'; fire(count, 'change');
    const on = root.querySelector('#ps-f-on') as HTMLInputElement; on.checked = true; fire(on, 'change');
    const size = root.querySelector('#ps-f-size') as HTMLSelectElement; size.value = 'l'; fire(size, 'change');
    const color = root.querySelector('#ps-f-color') as HTMLInputElement; color.value = '#00ff00'; fire(color, 'change');
    const icon = root.querySelector('#ps-f-icon') as HTMLSelectElement; icon.value = 'arrow'; fire(icon, 'change');
    expect(onChange.mock.calls).toEqual(expect.arrayContaining([
      ['title', 'New'], ['count', 7], ['on', true], ['size', 'l'], ['color', '#00ff00'], ['icon', 'arrow'],
    ]));
    count.value = ''; fire(count, 'change');
    expect(onChange).toHaveBeenLastCalledWith('count', undefined);
  });

  it('image fields go through the picker and clear to an empty value', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    const pickImage = vi.fn((_cur, done) => done({ src: '/new.jpg', alt: 'New', width: 10, height: 5 }));
    renderForm(root, schema, { image: { src: '/old.jpg', alt: 'Old' } }, { onChange, pickImage });
    const buttons = [...root.querySelectorAll('.ps-field--image button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent === 'Replace…')!.click();
    expect(pickImage).toHaveBeenCalledWith({ src: '/old.jpg', alt: 'Old' }, expect.any(Function));
    expect(onChange).toHaveBeenCalledWith('image', { src: '/new.jpg', alt: 'New', width: 10, height: 5 });
    buttons.find((b) => b.textContent === 'Remove')!.click();
    expect(onChange).toHaveBeenLastCalledWith('image', { src: '', alt: '' });
  });

  it('says so when a block has no settings', () => {
    const root = document.createElement('div');
    renderForm(root, { label: 'Empty', fields: {} }, {}, { onChange: vi.fn(), pickImage: vi.fn() });
    expect(root.textContent).toContain('no settings');
  });
});

describe('list fields', () => {
  const schema: BlockSchema = { label: 'Menu', fields: { nav: { type: 'list', label: 'Items', itemLabel: 'label', fields: {
    label: { type: 'text', label: 'Label' },
    links: { type: 'list', label: 'Links', itemLabel: 'label', fields: { label: { type: 'text', label: 'Label' } } },
  } } } };
  const setup = (nav: any[]) => {
    const root = document.createElement('div');
    const changes: any[] = [];
    renderForm(root, schema, { nav }, { onChange: (_n, v) => changes.push(v), pickImage: () => {} });
    return { root, changes, last: () => changes[changes.length - 1] };
  };
  const fire = (el: Element, type: string) => el.dispatchEvent(new (window as any).Event(type, { bubbles: true }));

  it('names rows from their label', () => {
    const { root } = setup([{ label: 'Home' }, {}]);
    expect([...root.querySelectorAll('#ps-f-nav > .ps-list__row > summary > .ps-ellipsis')].map((e) => e.textContent)).toEqual(['Home', 'Item 2']);
  });
  it('edits, adds and removes rows without touching the caller’s array', () => {
    const nav = [{ label: 'Home' }, { label: 'About' }];
    const { root, last } = setup(nav);
    const input = root.querySelector('#ps-f-nav-0-label') as HTMLInputElement;
    input.value = 'Start';
    fire(input, 'change');
    expect(last()).toEqual([{ label: 'Start' }, { label: 'About' }]);
    expect(nav[0].label).toBe('Home');
    (root.querySelector('#ps-f-nav > .ps-btn') as HTMLElement).click();
    expect(last()).toHaveLength(3);
    (root.querySelector('[aria-label="Remove Start"]') as HTMLElement).click();
    expect(last()).toEqual([{ label: 'About' }, {}]);
  });
  it('reorders rows', () => {
    const { root, last } = setup([{ label: 'A' }, { label: 'B' }]);
    (root.querySelector('#ps-f-nav > .ps-list__row [aria-label="Move down"]') as HTMLElement).click();
    expect(last().map((r: any) => r.label)).toEqual(['B', 'A']);
  });
  it('edits nested rows, and an emptied nested list disappears from the row', () => {
    const { root, last } = setup([{ label: 'A', links: [{ label: 'x' }] }]);
    const input = root.querySelector('#ps-f-nav-0-links-0-label') as HTMLInputElement;
    input.value = 'y';
    fire(input, 'change');
    expect(last()).toEqual([{ label: 'A', links: [{ label: 'y' }] }]);
    (root.querySelector('[aria-label="Remove y"]') as HTMLElement).click();
    expect(last()).toEqual([{ label: 'A' }]);
  });
});

describe('image fields stored as a URL', () => {
  it('redraws itself after a pick, for callers that never re-render', () => {
    const root = document.createElement('div');
    let pick: (img: any) => void = () => {};
    renderForm(root, { label: 'P', fields: { og: { type: 'image', label: 'Image', asUrl: true } } }, {}, { onChange: () => {}, pickImage: (_c, done) => { pick = done; } });
    expect(root.querySelector('.ps-field--image')?.textContent).toContain('No image');
    (root.querySelector('.ps-field--image .ps-btn') as HTMLElement).click();
    pick({ src: '/new.png', alt: 'x' });
    expect(root.querySelector('.ps-thumb img')?.getAttribute('src')).toBe('/new.png');
    expect(root.querySelector('.ps-field--image .ps-btn')?.textContent).toBe('Replace…');
  });
  it('fills the alt-text field named by altField, and hands it back to the picker', () => {
    const root = document.createElement('div');
    const out: [string, unknown][] = [];
    let pick: (img: any) => void = () => {};
    let given: any;
    renderForm(root, { label: 'P', fields: { image: { type: 'image', label: 'Image', asUrl: true, altField: 'imageAlt' }, imageAlt: { type: 'text', label: 'Image description' } } }, { image: '/a.jpg', imageAlt: 'Old' }, { onChange: (n, v) => out.push([n, v]), pickImage: (c, done) => { given = c; pick = done; } });
    (root.querySelector('.ps-field--image .ps-btn') as HTMLElement).click();
    expect(given).toEqual({ src: '/a.jpg', alt: 'Old' });
    pick({ src: '/b.jpg', alt: 'A gradient' });
    expect(out).toEqual([['image', '/b.jpg'], ['imageAlt', 'A gradient']]);
    expect((root.querySelector('#ps-f-imageAlt') as HTMLInputElement).value).toBe('A gradient');
  });
  it('picks and clears a bare string', () => {
    const root = document.createElement('div');
    const out: unknown[] = [];
    let pick: (img: any) => void = () => {};
    renderForm(root, { label: 'P', fields: { og: { type: 'image', label: 'Image', asUrl: true } } }, { og: '/a.jpg' }, { onChange: (_n, v) => out.push(v), pickImage: (_c, done) => { pick = done; } });
    expect(root.querySelector('.ps-thumb img')?.getAttribute('src')).toBe('/a.jpg');
    (root.querySelector('.ps-field--image .ps-btn') as HTMLElement).click();
    pick({ src: '/b.jpg', alt: 'x' });
    expect(out).toEqual(['/b.jpg']);
    (root.querySelector('.ps-field--image .ps-btn--ghost') as HTMLElement).click();
    expect(out).toEqual(['/b.jpg', '']);
  });
});

describe('date fields', () => {
  const input = (value: unknown, time?: boolean) => {
    const root = document.createElement('div');
    renderForm(root, { label: 'D', fields: { d: { type: 'date', label: 'Date', time } } } as BlockSchema, { d: value }, { onChange: vi.fn() } as any);
    return root.querySelector('input')!;
  };
  it('shows a stored day in a date input rather than a blank datetime', () => {
    expect(input('2026-10-19').type).toBe('date');
    expect(input('2026-10-19').value).toBe('2026-10-19');
  });
  it('keeps the time when there is one', () => expect(input('2026-10-19T08:30:00').type).toBe('datetime-local'));
  it('time: false wins', () => expect(input('2026-10-19T08:30:00', false).type).toBe('date'));
});
