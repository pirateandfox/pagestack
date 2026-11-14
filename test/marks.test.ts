// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { sanitizeFields, sanitizeMarks } from '../src/core/sanitize';
import { fieldOf } from '../src/core/schema';
import { renderForm } from '../src/client/form';
import { toggleMark } from '../src/client/rich';
import type { BlockSchema } from '../src/runtime';

// Bold and italic in one-line text fields (`marks: true`), e.g. a heading with one word in italics.
describe('sanitizeMarks', () => {
  it('keeps bold and italic, as <strong> and <em>', () => {
    expect(sanitizeMarks('Bread worth getting up <i>early</i> for')).toBe('Bread worth getting up <em>early</em> for');
    expect(sanitizeMarks('<b>Fresh</b> <strong>bread</strong> <em>daily</em>')).toBe('<strong>Fresh</strong> <strong>bread</strong> <em>daily</em>');
    expect(sanitizeMarks('<b><i>both</i></b>')).toBe('<strong><em>both</em></strong>');
  });
  it('drops every other tag and its attributes but keeps the words', () => {
    expect(sanitizeMarks('<p>One <a href="/x">link</a> <span style="color:red">and</span> <u>more</u></p>')).toBe('One link and more');
    expect(sanitizeMarks('<em class="x" onclick="alert(1)">hi</em>')).toBe('<em>hi</em>');
    expect(sanitizeMarks('<img src=x onerror=alert(1)>Hi<script>alert(1)</script>')).not.toMatch(/<(img|script)|onerror/);
  });
  it('stays one line, and keeps escaped text escaped', () => {
    expect(sanitizeMarks('Two<br>lines\n here&nbsp; ')).toBe('Two lines here');
    expect(sanitizeMarks('Fish &amp; chips &lt;3')).toBe('Fish &amp; chips &lt;3');
    expect(sanitizeMarks('<strong> </strong>Hi<em></em>')).toBe('Hi');
  });
  it('is what saving does to a text field with marks, and only to those', () => {
    const fields = { title: { type: 'text', label: 'T', marks: true }, plain: { type: 'text', label: 'P' } } as const;
    const out = sanitizeFields({ title: '<h2>A <i>b</i></h2>', plain: 'A <i>b</i>' }, fields as any);
    expect(out.title).toBe('A <em>b</em>');
    expect(out.plain).toBe('A <i>b</i>');
  });
});

describe('fieldOf', () => {
  const schema: BlockSchema = { label: 'S', fields: { title: { type: 'text', label: 'T', marks: true }, items: { type: 'list', label: 'L', fields: { label: { type: 'text', label: 'Label', marks: true }, url: { type: 'link', label: 'U' } } } } };
  it('finds a field, through list rows too', () => {
    expect(fieldOf(schema, 'title')?.marks).toBe(true);
    expect(fieldOf(schema, 'items.2.label')?.marks).toBe(true);
    expect(fieldOf(schema, 'items.2.url')?.type).toBe('link');
  });
  it('is undefined for paths the schema does not describe', () => {
    expect(fieldOf(schema, 'nope')).toBeUndefined();
    expect(fieldOf(schema, 'title.0')).toBeUndefined();
    expect(fieldOf(schema, 'toString')).toBeUndefined();
    expect(fieldOf(undefined, 'title')).toBeUndefined();
  });
});

describe('toggleMark', () => {
  const setup = (html: string) => { const el = document.createElement('h2'); el.contentEditable = 'true'; el.innerHTML = html; document.body.append(el); return el; };
  const select = (node: Node, start: number, end: number) => { const r = document.createRange(); r.setStart(node, start); r.setEnd(node, end); const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r); };
  it('wraps the selected words', () => {
    const el = setup('Up early today');
    select(el.firstChild!, 3, 8);
    expect(toggleMark(el, 'italic')).toBe(true);
    expect(el.innerHTML).toBe('Up <em>early</em> today');
  });
  it('takes the mark off when the selection is inside one', () => {
    const el = setup('Up <b>early</b> today');
    select(el.querySelector('b')!.firstChild!, 1, 3);
    expect(toggleMark(el, 'bold')).toBe(true);
    expect(el.innerHTML).toBe('Up early today');
  });
  it('does nothing with no selection in the field', () => {
    const el = setup('Plain');
    select(el.firstChild!, 2, 2);
    expect(toggleMark(el, 'bold')).toBe(false);
    expect(el.innerHTML).toBe('Plain');
  });
});

describe('the sidebar field', () => {
  it('is one editable line with just bold and italic', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    renderForm(root, { label: 'H', fields: { title: { type: 'text', label: 'Title', marks: true } } }, { title: 'Up <em>early</em><script>x</script>' }, { onChange, pickImage: vi.fn() });
    const body = root.querySelector<HTMLElement>('#ps-f-title')!;
    expect(body.isContentEditable || body.contentEditable === 'true').toBe(true);
    expect(body.innerHTML).toBe('Up <em>early</em>');
    expect([...root.querySelectorAll('button[data-cmd]')].map((b) => (b as HTMLElement).dataset.cmd)).toEqual(['bold', 'italic']);
    body.innerHTML = 'Up <b>early</b>';
    body.dispatchEvent(new Event('blur'));
    expect(onChange).toHaveBeenCalledWith('title', 'Up <strong>early</strong>', { live: false });
  });
});
