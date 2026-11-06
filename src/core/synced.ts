// Synced patterns stay plain content: each page holds its own copy, marked `synced: <pattern id>`.
// "Update all copies" rewrites every page in one commit, so the static build needs no lookup and
// a site that drops the editor still renders. Pure.
import type { Node, PageDoc } from '../runtime';
import { cloneWithNewIds } from '../runtime';

/** The page with each copy of the pattern replaced; `changed` is false when it has none. */
export function applySynced(doc: PageDoc, patternId: string, source: Node): { doc: PageDoc; changed: boolean } {
  let changed = false;
  const visit = (nodes: Node[]): Node[] => nodes.map((n) => {
    if (n.synced === patternId) {
      changed = true;
      const fresh = cloneWithNewIds(source);
      return { ...fresh, id: n.id, synced: patternId };
    }
    return n.blocks ? { ...n, blocks: visit(n.blocks) } : n;
  });
  return { doc: { ...doc, sections: visit(doc.sections) }, changed };
}
