// List View (left panel): the page's blocks as a tree. Drag to reorder or to move a block into
// another block that accepts it; the ⋮ on a row opens the same menu as the block toolbar.
import Sortable from 'sortablejs';
import type { Node, PageDoc, SchemaRegistry } from '../runtime';
import { allowedChildTypes, nodeLabel } from '../core/schema';
import { icons } from './icons';

export interface TreeCallbacks {
  onSelect: (path: string) => void;
  onMove: (fromPath: string, toListPath: string, toIndex: number) => void;
  canDrop: (fromPath: string, toListPath: string) => boolean;
  onMenu: (path: string, anchor: HTMLElement) => void;
}

/** Rows the person opened by hand, by node id, so they survive re-rendering. */
const opened = new Set<string>();

export function renderTree(root: HTMLElement, doc: PageDoc, registry: SchemaRegistry, selected: string | null, cb: TreeCallbacks) {
  root.innerHTML = '';
  root.append(list(doc.sections, 'sections', 0));

  function list(nodes: Node[], listPath: string, depth: number): HTMLElement {
    const ul = document.createElement('ul');
    ul.className = `ps-tree__list ps-tree__list--d${Math.min(depth, 3)}`;
    ul.dataset.list = listPath;
    nodes.forEach((n, i) => ul.append(item(n, `${listPath}.${i}`, depth)));
    Sortable.create(ul, {
      group: { name: 'ps-tree', pull: true, put: (to, _from, dragEl) => cb.canDrop((dragEl as HTMLElement).dataset.path!, (to.el as HTMLElement).dataset.list!) },
      animation: 120,
      handle: '.ps-tree__grip',
      draggable: '.ps-tree__item',
      fallbackOnBody: true,
      swapThreshold: 0.65,
      onEnd: (evt) => {
        const to = (evt.to as HTMLElement).dataset.list!;
        if (evt.newIndex == null || (evt.from === evt.to && evt.oldIndex === evt.newIndex)) return;
        cb.onMove((evt.item as HTMLElement).dataset.path!, to, evt.newIndex);
      },
    });
    return ul;
  }
  function item(n: Node, path: string, depth: number): HTMLElement {
    const hasKids = !!n.blocks?.length;
    const canHold = !!allowedChildTypes(n.type, registry)?.length;
    const open = opened.has(n.id) || !!selected?.startsWith(path + '.');
    const li = document.createElement('li');
    li.className = 'ps-tree__item' + (path === selected ? ' is-selected' : '') + (open ? ' is-open' : '');
    li.dataset.path = path;
    const row = document.createElement('div');
    row.className = 'ps-tree__row';
    row.innerHTML = `<span class="ps-tree__grip" title="Drag to move">${icons.grip}</span>${hasKids || canHold ? `<button type="button" class="ps-tree__toggle" aria-label="Show contents" aria-expanded="${open}">▸</button>` : '<span class="ps-tree__toggle ps-tree__toggle--leaf"></span>'}<span class="ps-tree__label"></span><button type="button" class="ps-tree__menu" aria-label="Block options">${icons.more}</button>`;
    row.querySelector('.ps-tree__label')!.textContent = nodeLabel(n, registry);
    if (n.synced) { const pill = document.createElement('span'); pill.className = 'ps-pill ps-pill--synced'; pill.textContent = 'Synced'; row.querySelector('.ps-tree__label')!.after(pill); }
    row.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const menu = t.closest<HTMLElement>('.ps-tree__menu');
      if (menu) { cb.onMenu(path, menu); return; }
      if (t.closest('.ps-tree__toggle')) {
        const on = li.classList.toggle('is-open');
        if (on) opened.add(n.id); else opened.delete(n.id);
        return;
      }
      cb.onSelect(path);
    });
    li.append(row);
    if (hasKids || canHold) li.append(list(n.blocks ?? [], `${path}.blocks`, depth + 1));
    return li;
  }
}
