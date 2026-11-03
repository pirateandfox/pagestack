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
    expect((root.querySelector('#ase-f-title') as HTMLInputElement).value).toBe('Hello');
    expect((root.querySelector('#ase-f-count') as HTMLInputElement).value).toBe('3');
    expect((root.querySelector('#ase-f-on') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#ase-f-size') as HTMLSelectElement).value).toBe('l');
    expect((root.querySelector('#ase-f-color') as HTMLInputElement).value).toBe('#ff0000');
    expect((root.querySelector('.ase-field--color input[type=color]') as HTMLInputElement).value).toBe('#ff0000');
    expect(root.querySelector('.ase-thumb img')?.getAttribute('src')).toBe('/a.png');
    expect((root.querySelector('.ase-field--image input[aria-label="Alt text"]') as HTMLInputElement).value).toBe('A');
    expect((root.querySelector('#ase-f-icon') as HTMLSelectElement).value).toBe('star');
    expect(root.querySelector('.ase-field--body, .ase-field--richtext textarea')).toBeTruthy();
    expect((root.querySelector('details.ase-group:last-of-type') as HTMLDetailsElement).open).toBe(false); // advanced collapsed
  });

  it('reports changes with the field name and a typed value', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    renderForm(root, schema, {}, { onChange, pickImage: vi.fn() });
    const title = root.querySelector('#ase-f-title') as HTMLInputElement; title.value = 'New'; fire(title, 'change');
    const count = root.querySelector('#ase-f-count') as HTMLInputElement; count.value = '7'; fire(count, 'change');
    const on = root.querySelector('#ase-f-on') as HTMLInputElement; on.checked = true; fire(on, 'change');
    const size = root.querySelector('#ase-f-size') as HTMLSelectElement; size.value = 'l'; fire(size, 'change');
    const color = root.querySelector('#ase-f-color') as HTMLInputElement; color.value = '#00ff00'; fire(color, 'change');
    const icon = root.querySelector('#ase-f-icon') as HTMLSelectElement; icon.value = 'arrow'; fire(icon, 'change');
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
    const buttons = [...root.querySelectorAll('.ase-field--image button')] as HTMLButtonElement[];
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
