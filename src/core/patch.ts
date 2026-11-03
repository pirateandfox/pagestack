// Pure helpers for addressing and mutating a PageDoc by path.
// Paths look like `sections.2.blocks.0.settings.heading`. Node paths stop at a node
// (`sections.2.blocks.0`). Every mutating helper returns a new document (deep clone + mutate);
// pages are a few dozen KB so this is cheap and keeps undo/redo trivial.
import type { Node, PageDoc } from '../runtime';

export type Path = string;

export function getAt(obj: any, path: Path): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setAt<T extends object>(doc: T, path: Path, value: unknown): T {
  const copy = structuredClone(doc) as any;
  const keys = path.split('.');
  let o = copy;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null) o[k] = /^\d+$/.test(k) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return copy;
}

export function isNodePath(path: Path): boolean {
  return /^sections\.\d+(\.blocks\.\d+)*$/.test(path);
}

export function nodeAt(doc: PageDoc, path: Path): Node | undefined {
  if (!isNodePath(path)) throw new Error(`not a node path: ${path}`);
  return getAt(doc, path);
}

/** Node path that owns a field path (`…blocks.0.settings.heading` -> `…blocks.0`). */
export function nodePathOf(fieldPath: Path): Path {
  const m = fieldPath.match(/^(sections\.\d+(?:\.blocks\.\d+)*)/);
  if (!m) throw new Error(`no node in path: ${fieldPath}`);
  return m[1];
}

/** Split a node path into its parent list path and index. Top-level parents are `sections`. */
export function splitNodePath(path: Path): { listPath: Path; index: number } {
  if (!isNodePath(path)) throw new Error(`not a node path: ${path}`);
  const i = path.lastIndexOf('.');
  return { listPath: path.slice(0, i), index: Number(path.slice(i + 1)) };
}

/** The list path (`sections` or `<node>.blocks`) for children of a node path, or of the page. */
export function childListPath(parentNodePath: Path | null): Path {
  return parentNodePath ? `${parentNodePath}.blocks` : 'sections';
}

function listAt(doc: any, listPath: Path, create = false): Node[] {
  let list = getAt(doc, listPath);
  if (!list && create) { // node without blocks yet
    const nodePath = listPath.replace(/\.blocks$/, '');
    const node = getAt(doc, nodePath);
    if (!node) throw new Error(`no node at ${nodePath}`);
    node.blocks = [];
    list = node.blocks;
  }
  if (!Array.isArray(list)) throw new Error(`no list at ${listPath}`);
  return list;
}

export function updateSettings(doc: PageDoc, nodePath: Path, patch: Record<string, unknown>): PageDoc {
  const copy = structuredClone(doc);
  const node = nodeAt(copy, nodePath);
  if (!node) throw new Error(`no node at ${nodePath}`);
  node.settings = { ...node.settings, ...patch };
  return copy;
}

export function insertNode(doc: PageDoc, listPath: Path, index: number, node: Node): PageDoc {
  const copy = structuredClone(doc);
  const list = listAt(copy, listPath, true);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, node);
  return copy;
}

export function removeNode(doc: PageDoc, nodePath: Path): PageDoc {
  const copy = structuredClone(doc);
  const { listPath, index } = splitNodePath(nodePath);
  listAt(copy, listPath).splice(index, 1);
  return copy;
}

/**
 * Move a node so it ends up at `toIndex` in `toListPath` (same list or another node's blocks).
 * `toIndex` is the final index, i.e. what SortableJS reports as `newIndex`.
 */
export function moveNode(doc: PageDoc, fromPath: Path, toListPath: Path, toIndex: number): PageDoc {
  if (toListPath.startsWith(fromPath + '.')) throw new Error('cannot move a node into itself');
  const copy = structuredClone(doc);
  const { listPath, index } = splitNodePath(fromPath);
  const from = listAt(copy, listPath);
  const [node] = from.splice(index, 1);
  const to = listAt(copy, toListPath, true);
  to.splice(Math.max(0, Math.min(toIndex, to.length)), 0, node);
  return copy;
}

export function replaceNode(doc: PageDoc, nodePath: Path, node: Node): PageDoc {
  const copy = structuredClone(doc);
  const { listPath, index } = splitNodePath(nodePath);
  listAt(copy, listPath)[index] = node;
  return copy;
}

/** Walk every node with its path. */
export function* walk(doc: PageDoc): Generator<{ node: Node; path: Path; depth: number }> {
  function* rec(nodes: Node[], prefix: string, depth: number): Generator<{ node: Node; path: Path; depth: number }> {
    for (let i = 0; i < nodes.length; i++) {
      const path = `${prefix}.${i}`;
      yield { node: nodes[i], path, depth };
      if (nodes[i].blocks) yield* rec(nodes[i].blocks!, `${path}.blocks`, depth + 1);
    }
  }
  yield* rec(doc.sections, 'sections', 0);
}

/** Find the path of a node by id (ids are unique per page). */
export function pathOfId(doc: PageDoc, id: string): Path | undefined {
  for (const { node, path } of walk(doc)) if (node.id === id) return path;
  return undefined;
}
