// Rich text is untrusted: it is typed, pasted, or arrives from another site. This is an allowlist
// sanitiser that needs no DOM, so the same code runs in the browser and on save. Tags that pass
// untouched keep their exact bytes, which keeps saves from rewriting existing content.
import type { Field, Node, PageDoc, SchemaRegistry } from '../runtime';

/** Dropped along with everything inside them. */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'title', 'head', 'select', 'xml']);

const CONTENT_TAGS = ['p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'span', 'div', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'];
const CONTENT_ATTRS = ['href', 'target', 'rel', 'title', 'class', 'id', 'style', 'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'colspan', 'rowspan', 'scope', 'dir', 'lang'];

/** Pasting keeps structure and drops everything that carries another site's styling. */
const PASTE_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote'];
const PASTE_ATTRS = ['href'];

const URL_ATTRS = new Set(['href', 'src']);
const SAFE_SCHEME = /^(https?|mailto|tel):/i;

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&colon;/gi, ':').replace(/&tab;/gi, '').replace(/&newline;/gi, '');

/** Relative URLs and http(s)/mailto/tel only; `javascript:` and friends are refused. */
export function safeUrl(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  const flat = decode(url).replace(/[\u0000- \u007f-\u009f]/g, '');
  const scheme = flat.match(/^[a-z][a-z0-9+.-]*:/i);
  return !scheme || SAFE_SCHEME.test(flat);
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Inline SVG (`svg` fields) and uploaded .svg files. No scripts, events, foreign content or animation. */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'title', 'desc', 'marker']);
const SVG_ATTRS = new Set(['xmlns', 'xmlns:xlink', 'xml:space', 'version', 'viewbox', 'preserveaspectratio', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'dx', 'dy', 'd', 'points', 'transform', 'fill', 'fill-rule', 'fill-opacity', 'clip-path', 'clip-rule', 'clippathunits', 'mask', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'letter-spacing', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'patternunits', 'patterntransform', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'id', 'class', 'style', 'role', 'focusable', 'href', 'xlink:href']);
const svgStyleOk = (v: string) => !/expression|javascript:|@import|url\(\s*["']?(?!#)/i.test(decode(v));

function scrubSvg(svg: string, { file }: { file: boolean }): string {
  let out = '', i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    if (lt < 0) { out += svg.slice(i); break; }
    out += svg.slice(i, lt);
    if (svg.startsWith('<!--', lt)) { const e = svg.indexOf('-->', lt + 4); i = e < 0 ? svg.length : e + 3; continue; }
    if (svg.startsWith('<![CDATA[', lt)) { const e = svg.indexOf(']]>', lt); i = e < 0 ? svg.length : e + 3; continue; }
    if (svg.startsWith('<?', lt)) { const e = svg.indexOf('?>', lt); i = e < 0 ? svg.length : e + 2; continue; }
    if (svg.startsWith('<!', lt)) { // doctype, with any internal entity subset
      const open = svg.indexOf('[', lt), gt = svg.indexOf('>', lt);
      const e = open > 0 && open < gt ? svg.indexOf(']>', open) : gt;
      i = e < 0 ? svg.length : e + (open > 0 && open < gt ? 2 : 1); continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(svg);
    if (!m) { out += '&lt;'; i = lt + 1; continue; }
    i = TAG.lastIndex;
    const [whole, slash, rawName, rawAttrs] = m;
    const name = rawName.toLowerCase();
    const closes = rawAttrs.trimEnd().endsWith('/');
    if (name === 'style' && file) { // stylesheets from design tools; never reached when inlined in a page
      if (slash || closes) continue;
      const end = svg.toLowerCase().indexOf('</style', i);
      if (end < 0) break;
      const css = svg.slice(i, end); const close = svg.indexOf('>', end);
      i = close < 0 ? svg.length : close + 1;
      if (svgStyleOk(css) && !css.includes('<')) out += `<style>${css}</style>`;
      continue;
    }
    if (!SVG_TAGS.has(name)) {
      if (!slash && !closes) { // unknown element: drop its content too (script, foreignObject, animate…)
        const end = svg.toLowerCase().indexOf(`</${name}`, i);
        if (end >= 0) { const close = svg.indexOf('>', end); i = close < 0 ? svg.length : close + 1; }
      }
      continue;
    }
    if (slash) { out += whole; continue; }
    const kept: string[] = [];
    let dropped = false;
    for (const a of rawAttrs.matchAll(ATTR)) {
      const key = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      const allowed = (SVG_ATTRS.has(key) || key.startsWith('aria-') || key.startsWith('data-'))
        && (key !== 'href' && key !== 'xlink:href' || /^#[\w-]+$/.test(value.trim()))
        && (key !== 'style' || svgStyleOk(value))
        && (!/^(fill|stroke|filter|mask|clip-path)$/.test(key) || svgStyleOk(value));
      if (!allowed) { dropped = true; continue; }
      kept.push(`${a[1]}="${value.replace(/"/g, '&quot;')}"`);
    }
    out += dropped ? `<${rawName}${kept.length ? ' ' + kept.join(' ') : ''}${closes ? ' /' : ''}>` : whole;
  }
  return out;
}

/** Inline SVG, or a plain icon name. */
export const sanitizeSvg = (svg: string) => scrubSvg(svg, { file: false });
/** An uploaded .svg: also keeps a `<style>` block, since design tools rely on one. Null when it isn't SVG. */
export function sanitizeSvgFile(svg: string): string | null {
  const out = scrubSvg(svg, { file: true }).trim();
  return /<svg[\s>]/i.test(out) ? out : null;
}

export function sanitizeHtml(html: string, { paste = false }: { paste?: boolean } = {}): string {
  const tags = new Set(paste ? PASTE_TAGS : CONTENT_TAGS);
  const attrs = new Set(paste ? PASTE_ATTRS : CONTENT_ATTRS);
  let out = '', i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(html);
    if (!m) { out += '&lt;'; i = lt + 1; continue; }
    i = TAG.lastIndex;
    const [whole, slash, rawName, rawAttrs] = m;
    let name = rawName.toLowerCase();
    if (DROP.has(name)) {
      if (!slash && !rawAttrs.trimEnd().endsWith('/')) {
        const end = html.toLowerCase().indexOf(`</${name}`, i);
        if (end < 0) break;
        const close = html.indexOf('>', end);
        i = close < 0 ? html.length : close + 1;
      }
      continue;
    }
    if (paste && name === 'div') name = 'p'; // Word and Docs wrap lines in these
    if (!tags.has(name)) continue;
    if (slash) { out += name === rawName.toLowerCase() ? whole : `</${name}>`; continue; }
    const kept: string[] = [];
    let dropped = false;
    for (const a of rawAttrs.matchAll(ATTR)) {
      const key = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (!attrs.has(key) || (URL_ATTRS.has(key) && !safeUrl(value))) { dropped = true; continue; }
      kept.push(a[2] === undefined && a[3] === undefined && a[4] === undefined ? key : `${key}="${value.replace(/"/g, '&quot;')}"`);
    }
    if (!dropped && name === rawName.toLowerCase()) out += whole;
    else out += `<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  }
  return paste ? out.replace(/<p>(\s|&nbsp;|<br>)*<\/p>/g, '').trim() : out;
}

/** Text with no markup at all, for values that end up in `<title>` and `<meta>`. */
export const plainText = (s: string) => s.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<\/?[a-zA-Z][^>]*>?/g, '').replace(/</g, '');

export interface CleanOptions {
  /** May this value stay raw in a `code` field? Only admins write raw HTML; others keep what is there. */
  rawOk?: (value: string) => boolean;
}

const TOKEN_OK = /^[\w .:#%/-]*$/;
const COLOR_OK = /^[^<>"'`;{}\\]*$/;
const ATTR_NAME = /^[a-zA-Z_:][\w:.-]*$/;
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Anything without a schema is treated as HTML that might get rendered. */
function cleanDeep(v: any, text: (s: string) => string): any {
  if (typeof v === 'string') return text(v);
  if (Array.isArray(v)) return v.map((x) => cleanDeep(x, text));
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x, text)]));
  return v;
}

/** The cleaned value, or undefined to drop it so the field's default applies. */
function cleanField(v: any, field: Field, o: CleanOptions): any {
  switch (field.type) {
    case 'list':
      return Array.isArray(v) ? v.filter(isRecord).map((row) => sanitizeFields(row, field.fields ?? {}, o)) : undefined;
    case 'select':
      if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
      // A value outside the options is usually an old one, so plain words stay and markup goes.
      return field.options?.some((x) => x.value === v) || (typeof v === 'string' && TOKEN_OK.test(v)) ? v : undefined;
    case 'number':
      return v === '' || Number.isFinite(typeof v === 'string' ? Number(v) : v) ? v : undefined;
    case 'boolean':
      return typeof v === 'boolean' || v === 'true' || v === 'false' ? v : undefined;
    case 'color':
      return typeof v === 'string' && COLOR_OK.test(v) ? v : undefined;
    case 'link':
      return typeof v !== 'string' || safeUrl(v) ? cleanDeep(v, sanitizeHtml) : '';
    case 'image':
      if (typeof v === 'string') return safeUrl(v) ? plainText(v) : '';
      if (isRecord(v)) { const c = cleanDeep(v, plainText); if (typeof c.src === 'string' && !safeUrl(c.src)) c.src = ''; return c; }
      return undefined;
    case 'svg':
      return typeof v === 'string' ? sanitizeSvg(v) : undefined;
    case 'code':
      return typeof v !== 'string' || o.rawOk?.(v) ? v : sanitizeHtml(v);
    default: // text, textarea, richtext
      return cleanDeep(v, sanitizeHtml);
  }
}

const CODE = /(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$|`[^`\n]+`)/gm;

/** Markdown may hold HTML, which Astro passes through. Code samples are left alone; everything else is cleaned. */
export function sanitizeMarkdown(md: string): string {
  return md.split(CODE).map((part, i) => {
    if (i % 2) return part;
    const held: string[] = [];
    const text = part.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, (_, u) => `\uE000${held.push(u) - 1}\uE001`); // autolinks look like tags
    return sanitizeHtml(text)
      .replace(/(\]\(\s*<?)([^)\s>]+)/g, (m, open, url) => (safeUrl(url) ? m : `${open}#`))
      .replace(/^(\s{0,3}\[[^\]]+\]:\s*<?)(\S+)/gm, (m, open, url) => (safeUrl(url.replace(/>$/, '')) ? m : `${open}#`))
      .replace(/\uE000(\d+)\uE001/g, (_, n) => `<${held[Number(n)]}>`);
  }).join('');
}

/** A copy of `values` that is safe to render with `set:html`, through repeatable rows too. Keys outside the schema are cleaned as HTML. */
export function sanitizeFields<T extends Record<string, any>>(values: T, fields: Record<string, Field>, o: CleanOptions = {}): T {
  const out: Record<string, any> = {};
  for (const [name, v] of Object.entries(values)) {
    const field = Object.hasOwn(fields, name) ? fields[name] : undefined;
    const c = field ? cleanField(v, field, o) : cleanDeep(v, sanitizeHtml);
    if (c !== undefined) out[name] = c;
  }
  return out as T;
}

/** Passthrough attributes get spread on an element: no events, no unsafe URLs, no invalid names. */
export function sanitizeAttrs(attrs: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const key = k.toLowerCase();
    if (!ATTR_NAME.test(k) || key.startsWith('on') || key === 'srcdoc') continue;
    if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(key) && !safeUrl(String(v))) continue;
    out[k] = v;
  }
  return out;
}

/** A copy of a node, children included, with every field cleaned. */
export function sanitizeNode(n: Node, registry: SchemaRegistry, o: CleanOptions = {}): Node {
  const fields = Object.hasOwn(registry, n.type) ? registry[n.type].fields : {};
  return {
    ...n,
    settings: sanitizeFields(n.settings, fields, o),
    ...(n.attrs ? { attrs: sanitizeAttrs(n.attrs) } : {}),
    ...(n.blocks ? { blocks: n.blocks.map((c) => sanitizeNode(c, registry, o)) } : {}),
  };
}

/** A copy of a page safe to store and render: everything but its structure is treated as untrusted. */
export function sanitizeDoc(doc: PageDoc, registry: SchemaRegistry, o: CleanOptions & { pageFields?: Record<string, Field> } = {}): PageDoc {
  const { sections, layout, ...rest } = doc;
  return {
    ...cleanDeep(rest, plainText),
    ...(layout ? { layout: sanitizeFields(layout, o.pageFields ?? {}, o) } : {}),
    sections: sections.map((n) => sanitizeNode(n, registry, o)),
  };
}

/** Every `code` value in a document, which is what a non-admin may keep as it is. */
export function codeValues(doc: PageDoc | null | undefined, registry: SchemaRegistry): Set<string> {
  const out = new Set<string>();
  const visit = (n: Node) => {
    const fields = Object.hasOwn(registry, n.type) ? registry[n.type].fields : {};
    for (const [k, f] of Object.entries(fields)) if (f.type === 'code' && typeof n.settings?.[k] === 'string') out.add(n.settings[k]);
    n.blocks?.forEach(visit);
  };
  doc?.sections?.forEach(visit);
  return out;
}
