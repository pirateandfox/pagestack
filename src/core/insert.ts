// What the block inserter offers at a given place in the page. Pure so the rules can be tested.
import type { Node, SchemaRegistry } from '../runtime';
import { accepts, allowedChildTypes } from './schema';
import { splitNodePath } from './patch';

export interface Pattern { label: string; description?: string; node: Node }
export interface SavedPattern extends Pattern { id: string; /** Copies stay linked, and can all be updated at once. */ synced?: boolean }

export interface InsertItem {
  /** Stable within one listing. */
  key: string;
  label: string;
  description?: string;
  category: string;
  keywords: string[];
  /** Create an empty block of this type… */
  type?: string;
  /** …or insert a copy of this ready-made node. */
  node?: Node;
  /** Saved by someone on this site, so it can also be deleted. */
  savedId?: string;
  /** Mark inserted copies as linked to this pattern. */
  syncedId?: string;
}

export const SAVED_CATEGORY = 'Saved patterns';

/**
 * Items for inserting into `parentType` (null = the page itself). At the top level the host's
 * presets are the choices, plus anything that is a free-form container. A host with no presets
 * gets every visible type.
 */
export function insertItems(parentType: string | null, registry: SchemaRegistry, presets: Pattern[], saved: SavedPattern[] = []): InsertItem[] {
  const fits = (n: Node) => accepts(parentType, n.type, registry);
  const items: InsertItem[] = saved.filter((p) => fits(p.node)).map((p) => ({ key: `saved:${p.id}`, label: p.label, description: p.description, category: SAVED_CATEGORY, ...(p.synced ? { syncedId: p.id } : {}), keywords: ['pattern', 'saved'], node: p.node, savedId: p.id }));
  const fromType = (type: string, category?: string): InsertItem => {
    const s = registry[type];
    return { key: `type:${type}`, label: s.label, description: s.description, category: category ?? s.category ?? 'Blocks', keywords: s.keywords ?? [], type };
  };
  if (parentType === null) {
    const containers = Object.entries(registry).filter(([, s]) => s.blocks === '*' && !s.hidden).map(([t]) => t);
    const listed = presets.length ? containers : Object.entries(registry).filter(([, s]) => !s.hidden).map(([t]) => t);
    items.push(...presets.filter((p) => fits(p.node)).map(presetItem(registry)));
    items.push(...listed.map((t) => fromType(t, presets.length ? 'Layout' : undefined)));
    return items;
  }
  items.push(...(allowedChildTypes(parentType, registry) ?? []).map((t) => fromType(t)));
  const offered = new Set(items.map((i) => i.type));
  items.push(...presets.filter((p) => fits(p.node) && (!offered.has(p.node.type) || registry[p.node.type].blocks)).map(presetItem(registry)));
  return items;
}

const presetItem = (registry: SchemaRegistry) => (p: Pattern, i: number): InsertItem => ({
  key: `preset:${i}`, label: p.label, description: p.description, category: registry[p.node.type]?.category ?? 'Sections', keywords: registry[p.node.type]?.keywords ?? [], node: p.node,
});

/** Matches every word of `query` against the label, description and keywords. */
export function searchItems(items: InsertItem[], query: string): InsertItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const hay = (i: InsertItem) => [i.label, i.description ?? '', i.category, ...i.keywords].join(' ').toLowerCase();
  const inLabel = (i: InsertItem) => (i.label.toLowerCase().startsWith(words[0]) ? 0 : 1);
  return items.filter((i) => { const h = hay(i); return words.every((w) => h.includes(w)); }).sort((a, b) => inLabel(a) - inLabel(b));
}

/** Items in display order, one entry per category. */
export function groupItems(items: InsertItem[]): { category: string; items: InsertItem[] }[] {
  const groups = new Map<string, InsertItem[]>();
  for (const i of items) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  return [...groups].map(([category, items]) => ({ category, items }));
}

/**
 * Where the toolbar's Add block button (and `/`) puts a new block: right after the selected one,
 * beside it in the same list, as WordPress does. With nothing selected, at the end of the page.
 * A container is no exception; adding inside one is its own Add block button.
 */
export function insertTarget(doc: { sections: Node[] }, selected: string | null): { listPath: string; index: number } {
  if (!selected) return { listPath: 'sections', index: doc.sections.length };
  const { listPath, index } = splitNodePath(selected);
  return { listPath, index: index + 1 };
}
