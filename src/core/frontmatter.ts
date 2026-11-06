// Markdown files with YAML frontmatter. Edits go through the parsed document, so keys and values
// nobody touched keep their exact formatting and a save doesn't rewrite the whole header.
import { Document, parseDocument } from 'yaml';

const FENCE = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export function parseMarkdown(raw: string): { data: Record<string, any>; body: string } {
  const m = raw.match(FENCE);
  if (!m) return { data: {}, body: raw };
  return { data: (parseDocument(m[1]).toJS() ?? {}) as Record<string, any>, body: raw.slice(m[0].length) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** New file content. `raw` is the current file, if any. Keys absent from `data` stay as they are. */
export function writeMarkdown(raw: string | null, data: Record<string, any>, body: string): string {
  const old = raw === null ? null : parseMarkdown(raw);
  const m = raw?.match(FENCE);
  const doc = m ? parseDocument(m[1]) : new Document({});
  let changed = !m;
  for (const [k, v] of Object.entries(data)) {
    if (same(old?.data[k], v)) continue;
    changed = true;
    if (v === undefined || v === null || v === '') doc.delete(k);
    else doc.set(k, doc.createNode(v, { flow: Array.isArray(v) }));
  }
  const head = changed ? doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd() : m![1];
  return `---\n${head}\n---\n${body}`;
}
