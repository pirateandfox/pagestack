// The sanitiser against a spec HTML parser: whatever goes in, what comes out must parse (as a
// browser would) to allowed elements with allowed attributes only.
import { describe, expect, it } from 'vitest';
import { parseFragment } from 'parse5';
import { sanitizeHtml, sanitizeMarkdown, sanitizeSvg } from '../src/core/sanitize';

const HTML_TAGS = new Set(['p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'span', 'div', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption']);
const HTML_ATTRS = new Set(['href', 'target', 'rel', 'title', 'class', 'id', 'style', 'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'colspan', 'rowspan', 'scope', 'dir', 'lang']);

function problems(html: string, tags: Set<string> | null, attrs: (k: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.tagName) {
      if (tags && !tags.has(n.tagName)) out.push(`<${n.tagName}>`);
      for (const a of n.attrs ?? []) {
        if (!attrs(a.name)) out.push(`${n.tagName}[${a.name}]`);
        if ((a.name === 'href' || a.name === 'src') && /^\s*(javascript|data|vbscript):/i.test(a.value.replace(/[\u0000- ]/g, ''))) out.push(`${a.name}=${a.value}`);
      }
    }
    for (const c of n.childNodes ?? []) walk(c);
    if (n.content) walk(n.content);
  };
  walk(parseFragment(html));
  return out;
}

const PAYLOADS = [
  `<img src=x id=ZG9j title=a'alt=' onerror=eval(atob(this.id)) title='lang'>`,
  `<img src=x title=a"alt=" onerror=alert(1) title="x">`,
  `<a href=x title=a'b onmouseover=alert(1) c='>x</a>`,
  `<img src=x alt='x'onerror=alert(1)>`,
  `<img src=x alt="x"onerror=alert(1)>`,
  `<img/src=x/onerror=alert(1)>`,
  `<img src=x =onerror=alert(1)>`,
  `<img src=x 'onerror=alert(1)>`,
  `<img src=x alt=a=b onerror=alert(1)>`,
  `<IMG SRC=x ONERROR=alert(1)>`,
  `<img src = x onerror = alert(1)>`,
  `<a href="javas&#x09;cript:alert(1)">x</a>`,
  `<a href=" javascript:alert(1)">x</a>`,
  `<img src=x title=">" onerror=alert(1)>`,
  `<img src=x title='>' onerror=alert(1)>`,
  `<img src=x title=a> onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `<scr<script>ipt>alert(1)</script>`,
  `<img src=x onerror=alert(1)//`,
  `<img src="x" alt='a"' onerror=alert(1) b='"'>`,
  `<img\tsrc=x\nonerror=alert(1)>`,
  `<img src=x \u000conerror=alert(1)>`,
  `<a href=x/onclick=alert(1)>x</a>`,
  `<p title="</p><img src=x onerror=alert(1)>">t</p>`,
  `<!--><img src=x onerror=alert(1)>-->`,
  `<!--x--!><img src=x onerror=alert(1)>-->`,
  `<a href=x title=a'' onclick=alert(1)>x</a>`,
  `<img src=x alt=' onerror=alert(1) '>`,
];

describe('sanitiser vs a spec HTML parser', () => {
  it('neutralises the known bypasses', () => {
    for (const p of PAYLOADS) {
      for (const paste of [false, true]) {
        const out = sanitizeHtml(p, { paste });
        expect(problems(out, HTML_TAGS, (k) => HTML_ATTRS.has(k)), `${p} -> ${out}`).toEqual([]);
      }
    }
  });

  it('holds for generated tag soup', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const bits = ['<', '>', '"', "'", '=', ' ', '/', '\t', '\n', 'img', 'a', 'p', 'src', 'x', 'alt', 'title', 'onerror', 'onclick', 'alert(1)', 'href', 'javascript:', '<!--', '-->', '`', 'svg', 'style'];
    for (let n = 0; n < 20000; n++) {
      let s = '<' + ['img', 'a', 'p', 'span'][rnd(4)] + ' ';
      for (let k = 0, len = 3 + rnd(14); k < len; k++) s += bits[rnd(bits.length)];
      if (rnd(2)) s += '>';
      const out = sanitizeHtml(s);
      const bad = problems(out, HTML_TAGS, (k) => HTML_ATTRS.has(k));
      if (bad.length) throw new Error(`${JSON.stringify(s)} -> ${JSON.stringify(out)}: ${bad.join(', ')}`);
    }
  });

  it('cleans HTML inside Markdown the same way', () => {
    const md = "Intro.\n\n<div>\n<img src=x id=ZG9j title=a'alt=' onerror=eval(atob(this.id)) title='lang'>\n</div>\n";
    expect(problems(sanitizeMarkdown(md), null, (k) => !k.startsWith('on'))).toEqual([]);
  });

  it('inline SVG: no event attributes', () => {
    for (const p of [`<svg viewBox="0 0 1 1"><path d=x title=a'fill=' onclick=alert(1) x='y'/></svg>`, `<svg><g/onload=alert(1)></g></svg>`]) {
      expect(problems(sanitizeSvg(p), null, (k) => !k.startsWith('on')), p).toEqual([]);
    }
  });

  it('keeps ordinary content byte for byte', () => {
    for (const ok of ['<p>Hi <a href="/x" target="_blank" rel="noopener">there</a></p>', '<p>a<br>b<br/>c<br />d</p>', '<img src="/a.png" alt="A">', '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg>']) {
      expect(ok.startsWith('<svg') ? sanitizeSvg(ok) : sanitizeHtml(ok)).toBe(ok);
    }
  });
});
