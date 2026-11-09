// Markdown bodies on the page. The editor renders a body block by block so each top-level block
// (paragraph, heading, list…) can carry its index; editing one on the page rewrites only that
// block's source, and every other byte of the file stays as it was. Runs in the browser and on
// the server (no DOM here; the HTML -> Markdown side takes an element and lives in the client).
import { Lexer, Parser, type Token, type Tokens } from 'marked';
import { sanitizeHtml } from './sanitize';

export interface Heading { depth: number; slug: string; text: string }

/** Blocks whose text can be edited in place; the rest (lists, tables, code, HTML) open the Markdown. */
export const INLINE_BLOCKS = new Set(['paragraph', 'heading']);

/** github-slugger's rules, which Astro uses for heading ids. */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

const lex = (md: string) => new Lexer({ gfm: true }).lex(md);
const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Sanitised HTML for a Markdown body, with heading ids, and with `data-ase-md` block markers when editing. */
export function renderMarkdown(md: string, { editing = false } = {}): { html: string; headings: Heading[] } {
  const tokens = lex(md);
  const slug = slugger();
  const headings: Heading[] = [];
  const parts: string[] = [];
  tokens.forEach((tok, i) => {
    if (tok.type === 'space') return;
    const list = Object.assign([tok], { links: tokens.links }) as unknown as Token[] & { links: typeof tokens.links };
    let html = sanitizeHtml(new Parser({ gfm: true }).parse(list));
    if (tok.type === 'heading') {
      const h = tok as Tokens.Heading;
      const text = plain(new Parser().parseInline(h.tokens));
      const id = slug(text);
      headings.push({ depth: h.depth, slug: id, text });
      html = html.replace(/^<h([1-6])(?![^>]*\sid=)/, `<h$1 id="${id}"`);
    }
    if (editing) {
      const only = (tok as Tokens.Paragraph).tokens?.filter((t) => !(t.type === 'text' && !t.raw.trim()));
      const kind = tok.type === 'paragraph' && only?.length === 1 && only[0].type === 'image' ? 'image' : INLINE_BLOCKS.has(tok.type) ? 'text' : 'block';
      html = html.replace(/^(\s*<[a-z][a-z0-9]*)/i, `$1 data-ase-md="${i}" data-ase-md-kind="${kind}"`);
      if (!/^\s*</.test(html)) html = `<div data-ase-md="${i}" data-ase-md-kind="block">${html}</div>`;
    }
    parts.push(html);
  });
  return { html: parts.join('\n'), headings };
}

/** The source of block `index`, as `renderMarkdown` numbered it, with where it sits in `md`. */
export function blockAt(md: string, index: number): { raw: string; start: number; end: number; type: string; depth?: number } | null {
  const tokens = lex(md);
  let at = 0;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].raw;
    if (i === index) {
      const pos = md.indexOf(raw, at);
      const start = pos === -1 ? at : pos;
      return { raw, start, end: start + raw.length, type: tokens[i].type, depth: (tokens[i] as Tokens.Heading).depth };
    }
    const pos = md.indexOf(raw, at);
    at = pos === -1 ? at + raw.length : pos + raw.length;
  }
  return null;
}

/** `md` with block `index` replaced by `source`, keeping the blank lines around it. */
export function replaceBlock(md: string, index: number, source: string): string {
  const b = blockAt(md, index);
  if (!b) return md;
  const trailing = b.raw.match(/\s*$/)![0];
  return md.slice(0, b.start) + source.trim() + trailing + md.slice(b.end);
}
