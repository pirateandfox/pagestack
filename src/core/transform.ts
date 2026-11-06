// "Turn this block into…": what a block can become, and carrying its content across. Pure.
import type { Field, Node, SchemaRegistry } from '../runtime';
import { accepts, allowedChildTypes, defaultSettings } from './schema';

const TEXT = new Set(['text', 'textarea', 'richtext']);
const isText = (f: Field) => TEXT.has(f.type);
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && !(v as any).src);

function contentFields(node: Node, registry: SchemaRegistry) {
  return Object.entries(registry[node.type]?.fields ?? {}).filter(([k, f]) => (isText(f) || f.type === 'image') && filled(node.settings[k]));
}

/** Types this block can become where it sits. Its content has to have somewhere to go. */
export function transformTargets(node: Node, parentType: string | null, registry: SchemaRegistry): { type: string; label: string }[] {
  const from = registry[node.type];
  if (!from) return [];
  const content = contentFields(node, registry);
  if (!content.length && !node.blocks?.length) return [];
  return Object.entries(registry).filter(([type, to]) => {
    if (type === node.type || to.hidden || !accepts(parentType, type, registry)) return false;
    if (from.transforms) return from.transforms.includes(type);
    const fields = Object.values(to.fields);
    if (content.some(([, f]) => isText(f)) && !fields.some(isText)) return false;
    if (content.some(([, f]) => f.type === 'image') && !fields.some((f) => f.type === 'image')) return false;
    if (node.blocks?.length) {
      const allowed = allowedChildTypes(type, registry);
      if (!allowed || !node.blocks.every((c) => allowed.includes(c.type))) return false;
    }
    return true;
  }).map(([type, s]) => ({ type, label: s.label }));
}

/** Plain to rich gets a paragraph; rich to plain keeps inline formatting and loses block tags. */
function convert(value: unknown, from: Field, to: Field): unknown {
  if (typeof value !== 'string' || !isText(from) || !isText(to)) return value;
  if (from.type !== 'richtext' && to.type === 'richtext') return `<p>${value}</p>`;
  if (from.type === 'richtext' && to.type !== 'richtext') return value.replace(/<\/(p|div|h[1-6]|li|blockquote)>\s*(?=.)/gi, ' ').replace(/<\/?(p|div|h[1-6]|ul|ol|li|blockquote)(\s[^>]*)?>/gi, '').trim();
  return value;
}

/** The block as `type`, keeping its id and children. Same-named fields first, then the rest in order. */
export function transformNode(node: Node, type: string, registry: SchemaRegistry): Node {
  const to = registry[type];
  const from = registry[node.type];
  const settings: Record<string, unknown> = defaultSettings(to);
  const left = contentFields(node, registry);
  const open = new Set(Object.keys(to.fields));
  for (const [k, f] of [...left]) {
    if (!open.has(k) || (isText(f) !== isText(to.fields[k])) || f.type === 'image' !== (to.fields[k].type === 'image')) continue;
    settings[k] = convert(node.settings[k], f, to.fields[k]);
    open.delete(k); left.splice(left.findIndex(([n]) => n === k), 1);
  }
  for (const [k, f] of left) {
    const slot = [...open].find((n) => (f.type === 'image' ? to.fields[n].type === 'image' : isText(to.fields[n])));
    if (!slot) continue;
    settings[slot] = convert(node.settings[k], f, to.fields[slot]);
    open.delete(slot);
  }
  // Style settings carry over when the new type has the same field and the value still fits.
  for (const [k, f] of Object.entries(from?.fields ?? {})) {
    const t = to.fields[k];
    if (t && t.type === f.type && !isText(f) && f.type !== 'image' && node.settings[k] !== undefined && (!t.options || t.options.some((o) => o.value === node.settings[k]))) settings[k] = node.settings[k];
  }
  const { blocks, ...rest } = node;
  return { ...rest, type, settings, ...(to.blocks ? { blocks: blocks ?? [] } : {}) };
}
