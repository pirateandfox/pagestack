// Fields marked `required`: what is still to fill in, and what a new collection item starts with.
// Pure, shared by the forms (which point at the field) and the API routes (which refuse the save).
import type { Field, Node, PageDoc, SchemaRegistry } from '../runtime';
import { isShown } from './schema';

type Fields = Record<string, Field>;
type Values = Record<string, any>;

export interface Missing {
  /** Where, in the form: `['year']`, or `['links', 1, 'url']` in a list's row. */
  path: (string | number)[];
  /** The field's label, with its row: "Links, item 2: URL". */
  label: string;
  /** In a page: the block it is in ("sections.2"), or null for the page's own fields. */
  node?: string | null;
}

const own = (o: Values, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** With nothing stored, what the form displays: the default, or a select's first option. */
function displayed(f: Field, v: unknown): unknown {
  return v ?? f.default ?? (f.type === 'select' ? f.options?.[0]?.value : undefined);
}

function isBlank(f: Field, v: unknown): boolean {
  if (v === undefined || v === null) return true;
  switch (f.type) {
    case 'boolean': return false;
    case 'image': return !String((typeof v === 'object' ? (v as any).src : v) ?? '').trim();
    case 'list': return !Array.isArray(v) || !v.length;
    case 'tags':
    case 'multiselect': return Array.isArray(v) ? !v.some((x) => String(x ?? '').trim()) : !String(v).trim();
    case 'richtext':
    case 'text':
      // Markup around nothing is nothing; a picture or an embed is something.
      return !/<(img|svg|iframe|video|audio|hr)\b/i.test(String(v)) && !String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
    default: return !String(v).trim();
  }
}

/** Required fields with no value. One that is hidden (`showIf`) isn't asked for; nor is a boolean, where off is an answer. */
export function missingFields(fields: Fields, values: Values, path: Missing['path'] = [], prefix = ''): Missing[] {
  return Object.entries(fields).flatMap(([name, f]) => {
    if (!isShown(name, fields, values)) return [];
    const v = displayed(f, own(values, name));
    const at = [...path, name];
    if (f.required && f.type !== 'boolean' && isBlank(f, v)) return [{ path: at, label: prefix + f.label }];
    if (f.type !== 'list' || !f.fields || !Array.isArray(v)) return [];
    return v.flatMap((row, i) => (row && typeof row === 'object' ? missingFields(f.fields!, row, [...at, i], `${prefix}${f.label}, item ${i + 1}: `) : []));
  });
}

/**
 * The values, with each required field that has nothing stored given what its form displays. A
 * default the editor sees but that isn't in the file is missing as far as the site's build goes.
 */
export function fillRequired<T extends Values>(fields: Fields, values: T): T {
  const out: Values = { ...values };
  for (const [name, f] of Object.entries(fields)) {
    if (!isShown(name, fields, values)) continue;
    const stored = own(values, name) ?? undefined;
    if (stored === undefined && f.required) {
      const v = displayed(f, stored);
      if (v !== undefined) out[name] = structuredClone(v);
    }
    if (f.type === 'list' && f.fields && Array.isArray(out[name])) out[name] = out[name].map((row: unknown) => (row && typeof row === 'object' ? fillRequired(f.fields!, row) : row));
  }
  return out as T;
}

/** What a page still needs before it can be on the site. Drafts aren't built, so they need nothing yet. */
export function missingInPage(page: PageDoc, registry: SchemaRegistry, pageFields: Fields): Missing[] {
  if (page.status === 'draft') return [];
  const out: Missing[] = missingFields(pageFields, page.layout ?? {}).map((m) => ({ ...m, node: null }));
  const visit = (n: Node, node: string) => {
    const schema = Object.hasOwn(registry, n.type) ? registry[n.type] : undefined;
    if (schema) out.push(...missingFields(schema.fields, n.settings ?? {}, [], `${schema.label}: `).map((m) => ({ ...m, node })));
    n.blocks?.forEach((c, i) => visit(c, `${node}.blocks.${i}`));
  };
  page.sections.forEach((s, i) => visit(s, `sections.${i}`));
  return out;
}

/** "Fill in Date, Year and Short title." */
export function missingMessage(missing: Missing[]): string {
  const names = missing.slice(0, missing.length > 4 ? 3 : 4).map((m) => m.label);
  if (missing.length > names.length) names.push(`${missing.length - names.length} more`);
  return `Fill in ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}.`;
}

/**
 * Front matter a new item starts with: each field's default, today's date, and a draft where there are drafts.
 * `now` is best the editor's own clock ("2026-11-24T18:49:35", no zone): the server's is UTC, which is
 * hours out, and in the evening tomorrow.
 */
export function newItemData(fields: Fields, now: Date | string = new Date()): Values {
  const data: Values = {};
  for (const [k, f] of Object.entries(fields)) if (f.default !== undefined && k !== 'title') data[k] = structuredClone(f.default);
  // Only the first date is "today": others (modified, reviewed on) mean something else happened.
  const dated = Object.entries(fields).find(([, f]) => f.type === 'date');
  const stamp = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(now) ? now : (now instanceof Date ? now : new Date()).toISOString().slice(0, 19);
  if (dated && data[dated[0]] === undefined) data[dated[0]] = stamp.slice(0, dated[1].time === false ? 10 : 19);
  if (fields.draft?.type === 'boolean') data.draft = true;
  return data;
}

/** Required fields Add has to ask for, because nothing above answers them. In one group, all in view. */
export function askedOnAdd(fields: Fields): Fields {
  const { title: _, ...rest } = fields;
  const start = newItemData(fields);
  const names = new Set<string>(missingFields(rest, start).map((m) => String(m.path[0])));
  // An answer may bring up another required field (`showIf`): that one has to be there to show.
  for (let before = -1; before !== names.size;) {
    before = names.size;
    for (const [k, f] of Object.entries(rest)) if (f.showIf && names.has(f.showIf.field) && missingFields({ [k]: f }, start).length) names.add(k);
  }
  return Object.fromEntries(Object.entries(rest).filter(([k]) => names.has(k)).map(([k, f]) => [k, { ...f, group: undefined }]));
}
