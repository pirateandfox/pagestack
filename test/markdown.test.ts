// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { blockAt, renderMarkdown, replaceBlock, slugger } from '../src/core/markdown';
import { blockToMarkdown } from '../src/client/tomarkdown';

const md = `Intro with **bold** and a [link](/a/).

## A heading

- one
- two

![Alt](/images/x.png)

Last paragraph.
`;

describe('renderMarkdown', () => {
  it('numbers top-level blocks only when editing, and gives headings ids', () => {
    const plain = renderMarkdown(md);
    expect(plain.html).not.toContain('data-ase-md');
    expect(plain.html).toContain('<h2 id="a-heading">A heading</h2>');
    expect(plain.headings).toEqual([{ depth: 2, slug: 'a-heading', text: 'A heading' }]);
    const doc = new DOMParser().parseFromString(renderMarkdown(md, { editing: true }).html, 'text/html');
    const blocks = [...doc.querySelectorAll<HTMLElement>('[data-ase-md]')].map((e) => [e.tagName, e.dataset.aseMd, e.dataset.aseMdKind]);
    expect(blocks).toEqual([['P', '0', 'text'], ['H2', '2', 'text'], ['UL', '4', 'block'], ['P', '6', 'image'], ['P', '8', 'text']]);
  });
  it('sanitises the body', () => {
    expect(renderMarkdown('Hi <script>alert(1)</script> <a href="javascript:x">x</a>').html).not.toMatch(/script|javascript/);
  });
  it('dedupes heading slugs like github-slugger', () => {
    const s = slugger();
    expect([s('Why it matters?'), s('Why it matters?'), s('Ünïcode & more')]).toEqual(['why-it-matters', 'why-it-matters-1', 'ünïcode--more']);
  });
});

describe('replaceBlock', () => {
  it('rewrites one block and leaves every other byte alone', () => {
    const out = replaceBlock(md, 8, 'Changed *last*.');
    expect(out).toBe(md.replace('Last paragraph.', 'Changed *last*.'));
    expect(replaceBlock(md, 2, '## New heading')).toBe(md.replace('## A heading', '## New heading'));
    expect(blockAt(md, 4)!.raw).toContain('- one');
    expect(replaceBlock(md, 99, 'x')).toBe(md);
  });
  it('can split a block into two paragraphs', () => {
    expect(replaceBlock('A\n\nB\n', 0, 'A1\n\nA2')).toBe('A1\n\nA2\n\nB\n');
  });
});

describe('blockToMarkdown', () => {
  const el = (html: string) => { const d = document.createElement('p'); d.innerHTML = html; return d; };
  it('turns toolbar formatting back into Markdown', () => {
    expect(blockToMarkdown(el('Some <strong>bold</strong>, <em>italic</em>, <a href="/x/">a link</a> and <code>code</code>.'))).toBe('Some **bold**, *italic*, [a link](/x/) and `code`.');
  });
  it('escapes characters that would become formatting', () => {
    expect(blockToMarkdown(el('2 * 3 = 6 and snake_case [x]'))).toBe('2 \\* 3 = 6 and snake\\_case \\[x\\]');
  });
  it('makes paragraphs from the divs a browser adds on Enter, and keeps headings headings', () => {
    expect(blockToMarkdown(el('First<div>Second</div>'))).toBe('First\n\nSecond');
    const h = document.createElement('h2'); h.innerHTML = 'New <b>title</b>';
    expect(blockToMarkdown(h, 2)).toBe('## New **title**');
  });
  it('keeps headings, quotes and lists the toolbar made inside a paragraph', () => {
    expect(blockToMarkdown(el('Intro<h2>Sub</h2><blockquote>Said</blockquote><ul><li>a</li><li><b>b</b></li></ul><ol><li>x</li></ol>'))).toBe('Intro\n\n## Sub\n\n> Said\n\n- a\n- **b**\n\n1. x');
  });
  it('round-trips through renderMarkdown unchanged', () => {
    const src = 'Text with **bold**, *em*, [link](/a/ "T") and `x`.';
    const doc = new DOMParser().parseFromString(renderMarkdown(src).html, 'text/html');
    expect(blockToMarkdown(doc.querySelector('p')!)).toBe(src);
  });
});
