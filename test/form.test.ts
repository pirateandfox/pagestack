// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderForm, showMissing } from '../src/client/form';
import { missingFields } from '../src/core/required';
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

describe('multiselect fields', () => {
  const days = { type: 'multiselect' as const, label: 'Repeats on', options: [{ value: 'mon', label: 'Monday' }, { value: 'tue', label: 'Tuesday' }, { value: 'wed', label: 'Wednesday' }] };
  const setup = (value: unknown, field: any = days) => {
    const root = document.createElement('div');
    const out: unknown[] = [];
    renderForm(root, { label: 'E', fields: { days: field } }, { days: value }, { onChange: (_n, v) => out.push(v), pickImage: () => {} });
    const boxes = [...root.querySelectorAll<HTMLInputElement>('#ps-f-days input[type=checkbox]')];
    const tick = (v: string) => { const b = boxes.find((x) => x.value === v)!; b.checked = !b.checked; fire(b, 'change'); };
    return { root, out, boxes, tick };
  };
  it('shows every option as a labelled checkbox in a named group', () => {
    const { root, boxes } = setup(['wed']);
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([['mon', false], ['tue', false], ['wed', true]]);
    expect([...root.querySelectorAll('.ps-checks label')].map((l) => l.textContent)).toEqual(['Monday', 'Tuesday', 'Wednesday']);
    expect(root.querySelector(`#${root.querySelector('[role=group]')!.getAttribute('aria-labelledby')}`)?.textContent).toBe('Repeats on');
  });
  it('reports an array in option order, whatever order they were ticked in', () => {
    const { out, tick } = setup(['wed']);
    tick('mon'); tick('wed'); tick('mon');
    expect(out).toEqual([['mon', 'wed'], ['mon'], []]);
  });
  it('keeps a value no longer offered until it is unticked', () => {
    const { out, tick } = setup(['fri']);
    tick('mon'); tick('fri');
    expect(out).toEqual([['mon', 'fri'], ['mon']]);
  });
  it('reads a single value, and nothing at all', () => {
    expect(setup('tue').boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(['tue']);
    expect(setup(undefined).boxes.some((b) => b.checked)).toBe(false);
  });
  it('in a list row, unticking everything beats the default', () => {
    for (const [def, want] of [[['mon'], [{ days: [] }]], [undefined, [{}]]] as const) {
      const root = document.createElement('div');
      const out: any[] = [];
      renderForm(root, { label: 'E', fields: { rows: { type: 'list', label: 'R', fields: { days: { ...days, default: def } } } } }, { rows: [{ days: ['mon'] }] }, { onChange: (_n, v) => out.push(v), pickImage: () => {} });
      const mon = root.querySelector<HTMLInputElement>('#ps-f-rows-0-days input[value=mon]')!;
      mon.checked = false; fire(mon, 'change');
      expect(out.at(-1)).toEqual(want);
    }
  });
});

describe('showIf', () => {
  const fields: BlockSchema['fields'] = {
    repeats: { type: 'select', label: 'Repeats', options: [{ value: '', label: 'Never' }, { value: 'weekly', label: 'Weekly' }] },
    until: { type: 'date', label: 'Until', time: false, showIf: { field: 'repeats', not: '' }, group: 'advanced' },
  };
  const hidden = (root: Element, id: string) => root.querySelector(id)!.closest<HTMLElement>('.ps-field')!.hidden;
  const choose = (root: Element, id: string, v: string) => { const s = root.querySelector<HTMLSelectElement>(id)!; s.value = v; fire(s, 'change'); };
  it('shows and hides as the other field changes, leaving the hidden value alone', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    renderForm(root, { label: 'E', fields }, { until: '2026-12-31' }, { onChange, pickImage: vi.fn() });
    expect(hidden(root, '#ps-f-until')).toBe(true);
    choose(root, '#ps-f-repeats', 'weekly');
    expect(hidden(root, '#ps-f-until')).toBe(false);
    expect((root.querySelector('#ps-f-until') as HTMLInputElement).value).toBe('2026-12-31');
    choose(root, '#ps-f-repeats', '');
    expect(hidden(root, '#ps-f-until')).toBe(true);
    expect(onChange.mock.calls).toEqual([['repeats', 'weekly'], ['repeats', '']]);
  });
  it('hides a group with nothing left in it', () => {
    const root = document.createElement('div');
    renderForm(root, { label: 'E', fields }, {}, { onChange: vi.fn(), pickImage: vi.fn() });
    const advanced = () => [...root.querySelectorAll<HTMLElement>('.ps-group')][1].hidden;
    expect(advanced()).toBe(true);
    choose(root, '#ps-f-repeats', 'weekly');
    expect(advanced()).toBe(false);
  });
  it('works within a list row, each row on its own', () => {
    const root = document.createElement('div');
    renderForm(root, { label: 'E', fields: { rows: { type: 'list', label: 'R', fields } } }, { rows: [{ repeats: 'weekly' }, {}] }, { onChange: vi.fn(), pickImage: vi.fn() });
    expect([hidden(root, '#ps-f-rows-0-until'), hidden(root, '#ps-f-rows-1-until')]).toEqual([false, true]);
    choose(root, '#ps-f-rows-1-repeats', 'weekly');
    expect(hidden(root, '#ps-f-rows-1-until')).toBe(false);
  });
});

describe('required fields', () => {
  const fields: BlockSchema['fields'] = {
    year: { type: 'number', label: 'Year', required: true, group: 'advanced' },
    on: { type: 'boolean', label: 'On', required: true },
    pics: { type: 'multiselect', label: 'Days', required: true, options: [{ value: 'a', label: 'A' }] },
    image: { type: 'image', label: 'Image', required: true },
    body: { type: 'richtext', label: 'Body', required: true },
    links: { type: 'list', label: 'Links', fields: { url: { type: 'link', label: 'URL', required: true } } },
  };
  const draw = (values: Record<string, unknown>, onChange = vi.fn()) => {
    const root = document.createElement('div'); document.body.append(root);
    renderForm(root, { label: 'X', fields }, values, { onChange, pickImage: vi.fn() });
    return root;
  };
  it('are starred, but not booleans', () => {
    const root = draw({ links: [{}] });
    expect([...root.querySelectorAll('.ps-req')].map((s) => s.parentElement!.textContent)).toEqual(['Days *', 'Image *', 'Body *', 'URL *', 'Year *']);
    expect(root.querySelector('#ps-f-year')!.getAttribute('aria-required')).toBe('true');
    expect(root.querySelector('#ps-f-on')!.hasAttribute('aria-required')).toBe(false);
  });
  it('are pointed at when missing, inside rows and closed groups too, until they change', () => {
    const values = { links: [{ url: '/a' }, {}], image: { src: '/a.png', alt: '' }, body: '<p>x</p>', pics: ['a'] };
    const root = draw(values);
    const missing = missingFields(fields, values);
    showMissing(root, missing);
    const marked = () => [...root.querySelectorAll<HTMLElement>('.is-missing')].map((w) => w.dataset.psForm);
    expect(marked()).toEqual(['ps-f-links-1-url', 'ps-f-year']);
    expect((root.querySelector('#ps-f-year')!.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect([...root.querySelectorAll<HTMLDetailsElement>('.ps-list__row')].map((d) => d.open)).toEqual([false, true]);
    expect(document.activeElement).toBe(root.querySelector('#ps-f-year')); // the first in form order
    const year = root.querySelector('#ps-f-year') as HTMLInputElement;
    year.value = '2020'; fire(year, 'change');
    expect(marked()).toEqual(['ps-f-links-1-url']);
    showMissing(root, missing); // saving again doesn't repeat the message
    expect(root.querySelectorAll('.ps-error')).toHaveLength(2);
    showMissing(root, [{ path: ['body'], label: 'Body' }]);
    expect(document.activeElement).toBe(root.querySelector('#ps-f-body')); // not its toolbar
    showMissing(root, []);
    expect(root.querySelectorAll('.ps-error, .is-missing')).toHaveLength(0);
  });
});
