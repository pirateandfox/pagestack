// Shared, framework-agnostic bits used by both the site's section components (at render time)
// and the editor. Nothing in here touches the DOM or Node APIs.

export type FieldType =
  | 'text' // single line, inline-editable
  | 'richtext' // HTML, inline-editable (bold / italic / link toolbar)
  | 'image' // { src, alt, width?, height? }, inline-editable (click -> picker)
  | 'link' // URL string
  | 'color' // CSS colour (hex, rgb(), var(--x))
  | 'select'
  | 'number'
  | 'boolean'
  | 'textarea' // multi-line plain text, sidebar only
  | 'code' // raw HTML / SVG, sidebar textarea
  | 'svg' // SVG markup or a named icon
  | 'date' // ISO date and time
  | 'tags' // array of strings
  | 'list'; // repeatable rows of sub-fields (menus, link lists); value is an array of objects

export interface Field {
  type: FieldType;
  label: string;
  default?: unknown;
  /** Field can be edited by clicking it in the page (text, richtext, image). */
  inline?: boolean;
  options?: { value: string; label: string }[];
  /** Sidebar grouping. Defaults to 'content'. */
  group?: 'content' | 'style' | 'advanced';
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  /** For 'svg': named icons offered in a dropdown besides raw SVG. */
  icons?: string[];
  /** For 'list': the fields of one row. */
  fields?: Record<string, Field>;
  /** For 'list': sub-field whose value names a row ("Item 3" otherwise). */
  itemLabel?: string;
  /** For 'date': false stores a day (2026-11-05) with no time. */
  time?: boolean;
  /** For 'image': store just the URL string instead of { src, alt }. */
  asUrl?: boolean;
  /** With `asUrl`: the text field that holds the image's alt text; the picker fills it. */
  altField?: string;
}

export interface BlockSchema {
  label: string;
  /** Short description shown in the add menu. */
  description?: string;
  fields: Record<string, Field>;
  /** Child block types this node accepts. '*' = any non-hidden type. Omit = leaf. */
  blocks?: string[] | '*';
  /** Hidden from the "add block" menus (e.g. items that only live inside their parent). */
  hidden?: boolean;
  /** Group in the block inserter. Defaults to "Blocks". */
  category?: string;
  /** Extra words the inserter's search matches. */
  keywords?: string[];
  /** Types this block may turn into. Omit to allow any type its content fits. */
  transforms?: string[];
}

export interface ImageValue { src: string; alt: string; width?: number; height?: number }

export interface Node {
  id: string;
  type: string;
  settings: Record<string, any>;
  blocks?: Node[];
  /** Passthrough HTML attributes for the root element (class, tag, aria-*…). Not shown as fields. */
  attrs?: Record<string, any>;
  /** Id of the synced pattern this node is a copy of. */
  synced?: string;
}

export interface PageDoc {
  title: string;
  /** 'draft' pages are editable but left out of the public build. Absent means published. */
  status?: 'draft' | 'published';
  description?: string;
  ogImage?: string;
  /** Site-specific frame data (layout, CSS files…); the editor never interprets it. */
  layout?: Record<string, any>;
  sections: Node[];
}

export interface Preset {
  label: string;
  description?: string;
  create: () => Node;
}

/** A folder of Markdown files with frontmatter (blog posts…), edited at /edit/collection/<id>. */
export interface CollectionDoc {
  /** Shown in the navigation, e.g. "Posts". */
  label: string;
  /** One item, e.g. "post". */
  singular?: string;
  /** Repo-relative folder of `.md` files. */
  dir: string;
  /** Frontmatter fields, in form order. `title` is the item's name; a boolean `draft` means Draft / Publish. */
  fields: Record<string, Field>;
  /** Site URL of an item, for "View" links. */
  url?: (slug: string) => string;
  /** false hides Add, for a fixed set of items. Otherwise new items start from each field's `default`. */
  create?: boolean;
}

/** A starting point offered by "Add page". */
export interface PageTemplate {
  label: string;
  description?: string;
  create: (ctx: { title: string }) => Partial<PageDoc>;
}

/** A site-wide document edited on its own screen (menus, footer, contact details). */
export interface GlobalDoc {
  label: string;
  description?: string;
  /** Repo-relative JSON file. Keys not listed in `fields` are preserved on save. */
  file: string;
  fields: Record<string, Field>;
}

/** Serialisable registry the editor UI receives (components stripped). */
export type SchemaRegistry = Record<string, BlockSchema>;

/** Edit context threaded through section components while rendering a preview. */
export interface EditCtx { path: string }

export function nodeAttrs(edit: EditCtx | undefined, node: Node): Record<string, string> {
  return edit ? { 'data-ps-node': edit.path, 'data-ps-type': node.type, 'data-ps-id': node.id } : {};
}
export function fieldAttrs(edit: EditCtx | undefined, name: string, type: FieldType): Record<string, string> {
  return edit ? { 'data-ps-field': `${edit.path}.settings.${name}`, 'data-ps-field-type': type } : {};
}
/**
 * Click-to-edit markers for a collection item's own fields in its `previews` layout, e.g.
 * `<h1 {...itemField(editing, 'title')}>`. Empty outside the editor.
 */
export function itemField(editing: boolean | undefined, name: string, type: 'text' | 'image' = 'text'): Record<string, string> {
  return editing ? { 'data-ps-field': name, 'data-ps-field-type': type } : {};
}
/** What a `previews` layout receives. `html` is the sanitised body; render it with set:html. */
export interface ItemPreviewProps {
  item: { id: string; collection: string; data: Record<string, any>; body: string; html: string; headings: { depth: number; slug: string; text: string }[] };
  editing: boolean;
}
/** Edit context for the i-th child block. */
export function child(edit: EditCtx | undefined, i: number): EditCtx | undefined {
  return edit ? { path: `${edit.path}.blocks.${i}` } : undefined;
}
export function rootEdit(editing: boolean, i: number): EditCtx | undefined {
  return editing ? { path: `sections.${i}` } : undefined;
}

export function newId(): string {
  return Math.random().toString(16).slice(2, 9);
}

/**
 * getStaticPaths for one catch-all page route, so a new JSON file is a new page with no wrapper:
 *
 *   export const getStaticPaths = () => staticPages(import.meta.glob('../content/pages/**\/*.json', { eager: true }));
 *
 * Drafts are left out. `base` is the path segment that ends the prefix of each glob key.
 */
export function staticPages(modules: Record<string, unknown>, { param = 'page', base = 'pages/' }: { param?: string; base?: string } = {}) {
  return Object.entries(modules).flatMap(([file, mod]) => {
    const page = ((mod as { default?: PageDoc }).default ?? mod) as PageDoc;
    if (page.status === 'draft') return [];
    const slug = file.slice(file.lastIndexOf(base) + base.length).replace(/\.json$/, '');
    return [{ params: { [param]: slug === 'index' ? undefined : slug }, props: { page } }];
  });
}

/** Apply schema defaults to a node's settings (does not mutate). */
export function withDefaults(node: Node, schema?: BlockSchema): Node {
  if (!schema) return node;
  const settings = { ...node.settings };
  for (const [k, f] of Object.entries(schema.fields)) if (settings[k] === undefined && f.default !== undefined) settings[k] = f.default;
  return { ...node, settings };
}

/** Deep clone a node with fresh ids (for duplicate / presets). */
export function cloneWithNewIds(node: Node): Node {
  return { ...node, id: newId(), settings: structuredClone(node.settings), attrs: node.attrs ? { ...node.attrs } : undefined, blocks: node.blocks?.map(cloneWithNewIds) };
}
