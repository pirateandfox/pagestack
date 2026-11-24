// Schema -> form model and node factories. Pure; used on the server (validation) and in the
// browser (sidebar forms, add menus).
import type { BlockSchema, Field, Node, PageDoc, SchemaRegistry, ShowIf } from '../runtime';
import { newId } from '../runtime';

export interface FormField { name: string; field: Field; value: unknown }
export interface FormGroup { name: 'content' | 'style' | 'advanced'; label: string; fields: FormField[] }

const GROUP_LABELS = { content: 'Content', style: 'Style', advanced: 'Advanced' } as const;

/** Fields of a schema grouped for the sidebar, with current values (defaults filled in). */
export function formModel(schema: BlockSchema, settings: Record<string, unknown> = {}): FormGroup[] {
  const groups: Record<string, FormField[]> = { content: [], style: [], advanced: [] };
  for (const [name, field] of Object.entries(schema.fields)) {
    const value = settings[name] !== undefined ? settings[name] : field.default;
    groups[field.group ?? 'content'].push({ name, field, value });
  }
  return (Object.keys(groups) as FormGroup['name'][]).filter((g) => groups[g].length).map((g) => ({ name: g, label: GROUP_LABELS[g], fields: groups[g] }));
}

/** A value as `showIf` compares it: always a list of strings, with every kind of "nothing" as ''. */
function comparable(v: unknown): string[] {
  if (Array.isArray(v)) return v.length ? v.flatMap(comparable) : [''];
  if (v && typeof v === 'object') return [String((v as any).src ?? 'set')]; // an image, or a list's row
  return [v === undefined || v === null || v === false ? '' : String(v)];
}

function conditionMet(when: ShowIf, value: unknown): boolean {
  const now = comparable(value);
  const any = (v: ShowIf['is']) => comparable(v).some((x) => now.includes(x));
  if (when.is === undefined && when.not === undefined) return now.some(Boolean);
  return (when.is === undefined || any(when.is)) && (when.not === undefined || !any(when.not));
}

/**
 * Does the form show this field? A field that depends on a hidden field is hidden too. A condition
 * naming a field that isn't there is ignored, so a typo can't put a field out of reach.
 */
export function isShown(name: string, fields: Record<string, Field>, settings: Record<string, unknown>, seen: string[] = []): boolean {
  const when = Object.hasOwn(fields, name) ? fields[name].showIf : undefined;
  if (!when || seen.includes(name)) return true;
  const other = Object.hasOwn(fields, when.field) ? fields[when.field] : undefined;
  const stored = Object.hasOwn(settings, when.field) ? settings[when.field] : undefined;
  if (!other && stored === undefined) return true;
  // With nothing stored, go by what the form displays: the default, or a select's first option.
  const value = stored ?? other?.default ?? (other?.type === 'select' ? other.options?.[0]?.value : undefined);
  return conditionMet(when, value) && isShown(when.field, fields, settings, [...seen, name]);
}

export function defaultSettings(schema: BlockSchema): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema.fields)) if (f.default !== undefined) s[k] = structuredClone(f.default);
  return s;
}

/** Block types a node of `parentType` accepts (null = leaf, accepts none). */
export function allowedChildTypes(parentType: string, registry: SchemaRegistry): string[] | null {
  const schema = registry[parentType];
  if (!schema?.blocks) return null;
  if (schema.blocks === '*') return Object.entries(registry).filter(([, s]) => !s.hidden).map(([t]) => t);
  return schema.blocks.filter((t) => t in registry);
}

export function createNode(type: string, registry: SchemaRegistry, settings: Record<string, unknown> = {}): Node {
  const schema = registry[type];
  if (!schema) throw new Error(`unknown block type: ${type}`);
  const node: Node = { id: newId(), type, settings: { ...defaultSettings(schema), ...settings } };
  if (schema.blocks) node.blocks = [];
  return node;
}

/** Inline-editable fields of a type (what clicking in the page can edit). */
export function inlineFields(schema: BlockSchema): string[] {
  return Object.entries(schema.fields).filter(([, f]) => f.inline).map(([k]) => k);
}

/**
 * The field a path inside a node's settings names: `title`, or `items.2.label` through a list's rows.
 * Undefined for anything the schema doesn't describe.
 */
export function fieldOf(schema: BlockSchema | undefined, settingsPath: string): Field | undefined {
  let fields = schema?.fields;
  let f: Field | undefined;
  for (const key of settingsPath.split('.')) {
    if (/^\d+$/.test(key)) { if (f?.type !== 'list') return undefined; continue; }
    f = fields && Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!f) return undefined;
    fields = f.fields;
  }
  return f;
}

/** Validate a document against the registry. Returns human-readable problems (empty = ok). */
export function validateDoc(doc: unknown, registry: SchemaRegistry): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object') return ['document is not an object'];
  const d = doc as PageDoc;
  if (typeof d.title !== 'string') errors.push('title must be a string');
  if (d.status !== undefined && d.status !== 'draft' && d.status !== 'published') errors.push('status must be "draft" or "published"');
  if (!Array.isArray(d.sections)) return [...errors, 'sections must be an array'];
  const ids = new Set<string>();
  const visit = (n: Node, path: string, parentType: string | null) => {
    if (!n || typeof n !== 'object') return errors.push(`${path}: not an object`);
    if (typeof n.id !== 'string' || !n.id) errors.push(`${path}: missing id`);
    else if (ids.has(n.id)) errors.push(`${path}: duplicate id ${n.id}`);
    else ids.add(n.id);
    const schema = registry[n.type];
    if (!schema) errors.push(`${path}: unknown type "${n.type}"`);
    if (!n.settings || typeof n.settings !== 'object') errors.push(`${path}: settings must be an object`);
    if (parentType && schema) {
      const allowed = allowedChildTypes(parentType, registry);
      if (allowed && !allowed.includes(n.type)) errors.push(`${path}: ${parentType} does not accept ${n.type}`);
    }
    if (n.blocks) {
      if (!Array.isArray(n.blocks)) errors.push(`${path}: blocks must be an array`);
      else n.blocks.forEach((c, i) => visit(c, `${path}.blocks.${i}`, n.type));
    }
  };
  d.sections.forEach((s, i) => visit(s, `sections.${i}`, null));
  return errors;
}

/** Can a node of `type` live in `parentType`? null means the top level of the page. */
export function accepts(parentType: string | null, type: string, registry: SchemaRegistry): boolean {
  if (!(type in registry)) return false;
  if (parentType === null) return !registry[type].hidden;
  return allowedChildTypes(parentType, registry)?.includes(type) ?? false;
}

/** Strip the components from a full registry so it can be sent to the browser. */
export function serializeRegistry(reg: Record<string, BlockSchema & { component?: unknown }>): SchemaRegistry {
  const out: SchemaRegistry = {};
  for (const [k, v] of Object.entries(reg)) { const { component: _c, ...rest } = v as any; out[k] = rest; }
  return out;
}

/** Short human label for a node in lists: schema label + first text-ish setting. */
export function nodeLabel(node: Node, registry: SchemaRegistry): string {
  const schema = registry[node.type];
  const base = schema?.label ?? node.type;
  for (const [k, f] of Object.entries(schema?.fields ?? {})) {
    if (f.inline && (f.type === 'text' || f.type === 'richtext') && typeof node.settings[k] === 'string' && node.settings[k]) {
      const t = String(node.settings[k]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (t) return `${base}: ${t.length > 36 ? t.slice(0, 35) + '…' : t}`;
    }
  }
  if (node.blocks?.length) {
    const flat: Node[] = [];
    // Blocks that hold other blocks say nothing about themselves; look through them for text.
    const rec = (n: Node) => { for (const b of n.blocks ?? []) { if (b.blocks?.length) rec(b); else flat.push(b); } };
    rec(node);
    const pick = flat.find((b) => b.type === 'heading') ?? flat.find((b) => b.type === 'text') ?? flat[0];
    if (pick) { const inner = nodeLabel(pick, registry); return `${base} · ${inner.replace(/^[^:]+: /, '')}`; }
  }
  return base;
}
