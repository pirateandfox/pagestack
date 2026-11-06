import { describe, expect, it } from 'vitest';
import { sanitizeDoc, sanitizeFields, sanitizeHtml, sanitizeSvg, sanitizeSvgFile, safeUrl } from '../src/core/sanitize';
import type { SchemaRegistry } from '../src/runtime';

describe('sanitizeHtml', () => {
  it('leaves ordinary content byte for byte', () => {
    for (const html of [
      '<p>Hello <strong>there</strong>, <a href="/contact/">contact us</a>.</p>',
      '<ul class="ticks"><li>One</li><li>Two</li></ul>',
      '<p style="text-align: center;">Centre<br />line</p>',
      '<h3>A &amp; B</h3><p>1 &lt; 2 > 0</p>',
      '<a href="mailto:a@b.co">m</a> <a href="tel:+1800">t</a> <a href="#x">h</a> <a href="https://x.co/?a=1&amp;b=2" target="_blank" rel="noopener">e</a>',
      "<img src='/a.jpg' alt=\"it's\" width=\"10\">",
    ]) expect(sanitizeHtml(html)).toBe(html);
  });
  it('removes scripts and their contents', () => {
    expect(sanitizeHtml('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitizeHtml('a<SCRIPT SRC=x></SCRIPT >b')).toBe('ab');
    expect(sanitizeHtml('a<script>never closed')).toBe('a');
    expect(sanitizeHtml('<style>p{}</style><iframe src="https://x"></iframe><svg onload=alert(1)><a/></svg>ok')).toBe('ok');
  });
  it('removes event handlers and keeps the rest of the tag', () => {
    expect(sanitizeHtml('<p onclick="x()" class="a">t</p>')).toBe('<p class="a">t</p>');
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('<img src="x">');
    expect(sanitizeHtml('<a href="/x"onmouseover="y">t</a>')).toBe('<a href="/x">t</a>');
    expect(sanitizeHtml('<p/onclick=x>t</p>')).toBe('<p>t</p>');
  });
  it('removes dangerous URLs however they are written', () => {
    for (const h of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java&#10;script:alert(1)', 'java&#x0A;script:alert(1)', 'javascript&colon;alert(1)', 'vbscript:x', 'data:text/html,x', '&#106;avascript:x'])
      expect(sanitizeHtml(`<a href="${h}">t</a>`)).toBe('<a>t</a>');
  });
  it('drops unknown tags but keeps their text', () => {
    expect(sanitizeHtml('<custom-el>keep</custom-el> <form>me</form>')).toBe('keep me');
  });
  it('removes comments, and a stray < cannot open a tag', () => {
    expect(sanitizeHtml('a<!-- x -->b<!-- unclosed')).toBe('ab');
    expect(sanitizeHtml('1 < 2 <3')).toBe('1 &lt; 2 &lt;3');
    expect(sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')).not.toMatch(/<script/i);
  });
  it('quotes attribute values safely when it rebuilds a tag', () => {
    expect(sanitizeHtml(`<a onclick=x title='say "hi"'>t</a>`)).toBe('<a title="say &quot;hi&quot;">t</a>');
  });
});

describe('sanitizeHtml paste mode', () => {
  it('keeps structure, drops styling', () => {
    expect(sanitizeHtml('<p class="MsoNormal" style="color:red"><span style="font-size:11pt"><b>Bold</b> text</span></p>', { paste: true })).toBe('<p><b>Bold</b> text</p>');
    expect(sanitizeHtml('<h1>Top</h1><h2 id="x">Sub</h2>', { paste: true })).toBe('Top<h2>Sub</h2>');
    expect(sanitizeHtml('<a href="https://x.co" class="c" target="_blank">l</a>', { paste: true })).toBe('<a href="https://x.co">l</a>');
  });
  it('handles Word and Docs wrappers', () => {
    expect(sanitizeHtml('<!--[if gte mso 9]><xml>junk</xml><![endif]--><o:p>x</o:p><meta charset="utf-8"><div>line</div><p>&nbsp;</p><p></p>', { paste: true })).toBe('x<p>line</p>');
  });
});

describe('safeUrl', () => {
  it('allows relative and web URLs', () => { for (const u of ['/a', 'a/b', '#x', '?q=1', 'https://x.co', 'mailto:a@b', 'tel:1', '']) expect(safeUrl(u)).toBe(true); });
  it('refuses other schemes', () => { for (const u of ['javascript:x', 'data:x', 'file:///etc/passwd']) expect(safeUrl(u)).toBe(false); });
});

describe('sanitizeDoc', () => {
  const registry: SchemaRegistry = { box: { label: 'Box', blocks: '*', fields: { html: { type: 'richtext', label: 'H' }, href: { type: 'link', label: 'L' }, raw: { type: 'code', label: 'C' }, name: { type: 'text', label: 'N' } } } };
  it('cleans rich text and links at any depth, and keeps raw code only for those allowed', () => {
    const doc = { title: 't', sections: [{ id: 'a', type: 'box', settings: { html: '<p onclick="x">a</p>', href: 'javascript:x', raw: '<script>ok()</script>', name: '<b>' }, blocks: [{ id: 'b', type: 'box', settings: { html: '<script>x</script>y', href: '/ok/' } }] }] };
    const out = sanitizeDoc(doc, registry, { rawOk: () => true });
    expect(out.sections[0].settings).toEqual({ html: '<p>a</p>', href: '', raw: '<script>ok()</script>', name: '<b>' });
    expect(sanitizeDoc(doc, registry).sections[0].settings.raw).toBe('');
    expect(out.sections[0].blocks![0].settings).toEqual({ html: 'y', href: '/ok/' });
    expect(doc.sections[0].settings.href).toBe('javascript:x'); // input untouched
  });
});

describe('sanitizeFields', () => {
  it('reaches into nested repeatable rows', () => {
    const fields = { nav: { type: 'list' as const, label: 'N', fields: { href: { type: 'link' as const, label: 'L' }, links: { type: 'list' as const, label: 'S', fields: { href: { type: 'link' as const, label: 'L' } } } } } };
    const out = sanitizeFields({ nav: [{ href: 'javascript:x', links: [{ href: 'data:text/html,x' }, { href: '/ok/' }] }], other: 'javascript:kept' }, fields);
    expect(out).toEqual({ nav: [{ href: '', links: [{ href: '' }, { href: '/ok/' }] }], other: 'javascript:kept' });
  });
});

describe('every field type is safe to render raw', () => {
  const P = '<img src=x onerror=alert(1)>';
  const fields = {
    t: { type: 'text', label: '' }, a: { type: 'textarea', label: '' }, r: { type: 'richtext', label: '' },
    s: { type: 'select', label: '', options: [{ value: 'one', label: '' }] }, n: { type: 'number', label: '' }, b: { type: 'boolean', label: '' },
    c: { type: 'color', label: '' }, l: { type: 'link', label: '' }, i: { type: 'image', label: '' }, v: { type: 'svg', label: '' }, h: { type: 'code', label: '' },
    rows: { type: 'list', label: '', fields: { t: { type: 'text', label: '' } } },
  } as any;
  const registry = { x: { label: 'X', fields, blocks: '*' } } as any;
  const dirty = { t: P, a: P, r: P, s: P, n: P, b: P, c: P, l: 'javascript:alert(1)', i: { src: 'javascript:alert(1)', alt: P }, v: `<svg onload="alert(1)"><script>alert(1)</script><path d="M0"/></svg>`, h: P, rows: [{ t: P }, 'nope'], unknown: P, deep: { list: [P] } };

  it('leaves no way to run script in any of them', () => {
    const out = sanitizeFields(dirty, fields);
    expect(JSON.stringify(out)).not.toMatch(/onerror|onload|<script|javascript:/);
  });
  it('keeps ordinary values exactly as they are', () => {
    const fine = { t: 'Tom &amp; Jerry <strong>now</strong><br>', a: 'Line', r: '<p class="x">Hi</p>', s: 'one', n: 3, b: true, c: 'var(--brand, #fff)', l: '/about/', i: { src: '/a.jpg', alt: 'A' }, v: '<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', rows: [{ t: 'One' }], extra: 'Plain & simple' };
    expect(sanitizeFields(fine, fields)).toEqual(fine);
    expect(sanitizeFields({ v: 'star' }, fields)).toEqual({ v: 'star' });
  });
  it('drops bad enumerated values so the default applies', () => {
    expect(sanitizeFields({ s: 'two<b>', n: 'x', b: 'maybe', c: 'red;}' }, fields)).toEqual({});
    expect(sanitizeFields({ s: 'start' }, fields)).toEqual({ s: 'start' }); // an old value is not an attack
  });
  it('keeps raw HTML in a code field only when allowed', () => {
    expect(sanitizeFields({ h: '<script src="/x.js"></script>' }, fields).h).toBe('');
    expect(sanitizeFields({ h: '<script src="/x.js"></script>' }, fields, { rawOk: () => true }).h).toBe('<script src="/x.js"></script>');
  });
  it('cleans title, description, attrs and layout on a page', () => {
    const doc = { title: 'A & B</title><script>alert(1)</script>', description: '"><img src=x onerror=alert(2)>', ogImage: '/a.jpg', layout: { css: ['a.css'], note: P }, sections: [{ id: 'a', type: 'x', settings: { t: P }, attrs: { onclick: 'alert(1)', class: 'k', href: 'javascript:alert(1)', 'bad name': 1 } }] } as any;
    const out = sanitizeDoc(doc, registry);
    expect(JSON.stringify(out)).not.toMatch(/onerror|onclick|<script|javascript:|bad name/);
    expect(out.title.startsWith('A & B')).toBe(true);
    expect(out.ogImage).toBe('/a.jpg');
    expect(out.sections[0].attrs).toEqual({ class: 'k' });
  });
  it('treats an unknown or prototype type as having no schema', () => {
    expect(JSON.stringify(sanitizeDoc({ title: 'x', sections: [{ id: 'a', type: '__proto__', settings: { t: P } }] } as any, registry))).not.toContain('onerror');
  });
  it('survives odd markup meant to confuse a tag parser', () => {
    for (const s of ['<img/src=x/onerror=alert(1)>', `<img title='a" onerror=alert(1) x='>x`, '<a href="java&#115;cript:alert(1)">x</a>', '<a href=" javascript:alert(1)">x</a>', '<scr<script>ipt>alert(1)</script>', '<svg><script>alert(1)</script></svg>', '<!--><img src=x onerror=alert(1)>-->']) {
      const t = sanitizeHtml(s);
      expect(t.replace(/title='[^']*'/, '')).not.toMatch(/<[^>]*\son\w+=|<script|href="\s*java/i);
    }
  });
});

describe('sanitizeSvg', () => {
  it('removes what can run, keeps what draws', () => {
    const out = sanitizeSvg(`<svg viewBox="0 0 1 1" onload="x()"><script>x()</script><foreignObject><img src=x onerror=y()></foreignObject><a href="javascript:x()"><path d="M0"/></a><animate attributeName="href" to="javascript:x()"/><use href="https://evil.test/x.svg#a"/><use href="#a"/><circle r="1" style="fill:url(https://evil.test)"/></svg>`);
    expect(out).not.toMatch(/onload|script|foreignObject|onerror|animate|evil\.test/i);
    expect(out).toContain('viewBox="0 0 1 1"');
    expect(out).toContain('<use href="#a"/>');
  });
  it('strips doctypes, entities and CDATA from files, and keeps design-tool styles', () => {
    const out = sanitizeSvgFile(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"><![CDATA[<script>1</script>]]><style>.a{fill:red}</style><path class="a" d="M0"/></svg>`)!;
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style><path class="a" d="M0"/></svg>');
    expect(sanitizeSvgFile('<svg><style>@import "https://evil.test/x.css";</style></svg>')).toBe('<svg></svg>');
    expect(sanitizeSvgFile('not svg')).toBeNull();
  });
});
