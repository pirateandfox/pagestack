// The HTML of one edited block back to Markdown. Only what the inline toolbar can produce has a
// Markdown form (bold, italic, links, code, strike, line breaks); anything else keeps its HTML,
// which Markdown allows inline. Paragraphs a browser made on Enter become separate paragraphs.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/([*_`[\]<])/g, '\\$1');
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);

function inline(node: Node): string {
  if (node.nodeType === 3) return esc((node.textContent ?? '').replace(/ /g, ' '));
  if (node.nodeType !== 1) return '';
  const el = node as HTMLElement;
  const kids = () => [...el.childNodes].map(inline).join('');
  const wrapIn = (mark: string) => { const inner = kids(); const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!; return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner; };
  switch (el.tagName) {
    case 'STRONG': case 'B': return wrapIn('**');
    case 'EM': case 'I': return wrapIn('*');
    case 'S': case 'DEL': case 'STRIKE': return wrapIn('~~');
    case 'CODE': return '`' + (el.textContent ?? '').replace(/`/g, '\\`') + '`';
    case 'BR': return '  \n';
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      const title = el.getAttribute('title');
      const target = el.getAttribute('target');
      if (target) return el.outerHTML; // Markdown links can't say "new tab"
      return `[${kids()}](${href.replace(/[ )]/g, (c) => encodeURIComponent(c))}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'IMG': return `![${esc(el.getAttribute('alt') ?? '')}](${el.getAttribute('src') ?? ''})`;
    case 'SPAN': case 'FONT': return kids();
    default: return BLOCK.has(el.tagName) ? kids() : `<${el.tagName.toLowerCase()}>${kids()}</${el.tagName.toLowerCase()}>`;
  }
}

/** Markdown for an edited paragraph, heading, flat list or quote. `depth` makes its own text a heading of that level. */
export function blockToMarkdown(el: HTMLElement, depth?: number): string {
  const out: string[] = [];
  const text = (nodes: Node[]) => nodes.map(inline).join('').replace(/ {2}\n$/, '').trim();
  const head = (n: number, t: string) => `${'#'.repeat(n)} ${t.replace(/ {2}\n/g, ' ')}`;
  let loose: Node[] = [];
  const flush = () => { const t = text(loose); loose = []; if (t) out.push(depth ? head(depth, t) : t); };
  // The toolbar's heading, quote and list buttons, and Enter, leave block elements inside the edited one.
  // A list or quote edited as a whole is its own first block.
  const nodes = /^(UL|OL|BLOCKQUOTE)$/.test(el.tagName) ? [el as Node] : [...el.childNodes];
  for (const n of nodes) {
    const tag = n.nodeType === 1 ? (n as HTMLElement).tagName : '';
    if (!BLOCK.has(tag)) { loose.push(n); continue; }
    flush();
    const kids = [...n.childNodes];
    if (/^H[1-6]$/.test(tag)) { const t = text(kids); if (t) out.push(head(Number(tag[1]), t)); }
    else if (tag === 'BLOCKQUOTE') { const t = text(kids); if (t) out.push(t.split('\n').map((l) => `> ${l}`).join('\n')); }
    else if (tag === 'UL' || tag === 'OL') {
      const items = kids.filter((k) => (k as HTMLElement).tagName === 'LI').map((li, i) => `${tag === 'OL' ? `${i + 1}.` : '-'} ${text([...li.childNodes])}`);
      if (items.length) out.push(items.join('\n'));
    } else { const t = text(kids); if (t) out.push(depth && tag !== 'P' ? head(depth, t) : t); }
  }
  flush();
  return out.join('\n\n');
}
