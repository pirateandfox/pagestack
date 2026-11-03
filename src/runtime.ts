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
  | 'svg'; // SVG markup or a named icon

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
}

export interface ImageValue { src: string; alt: string; width?: number; height?: number }

export interface Node {
  id: string;
  type: string;
  settings: Record<string, any>;
  blocks?: Node[];
  /** Passthrough HTML attributes for the root element (class, tag, aria-*…). Not shown as fields. */
  attrs?: Record<string, any>;
}

export interface PageDoc {
  title: string;
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

/** Serialisable registry the editor UI receives (components stripped). */
export type SchemaRegistry = Record<string, BlockSchema>;

/** Edit context threaded through section components while rendering a preview. */
export interface EditCtx { path: string }

export function nodeAttrs(edit: EditCtx | undefined, node: Node): Record<string, string> {
  return edit ? { 'data-ase-node': edit.path, 'data-ase-type': node.type, 'data-ase-id': node.id } : {};
}
export function fieldAttrs(edit: EditCtx | undefined, name: string, type: FieldType): Record<string, string> {
  return edit ? { 'data-ase-field': `${edit.path}.settings.${name}`, 'data-ase-field-type': type } : {};
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
