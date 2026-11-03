// Left panel: the section/block tree with drag-to-reorder (SortableJS) within each list.
import Sortable from 'sortablejs';
import type { Node, PageDoc, SchemaRegistry } from '../runtime';
import { nodeLabel } from '../core/schema';

export interface TreeCallbacks {
  onSelect: (path: string) => void;
  onMove: (fromPath: string, toListPath: string, toIndex: number) => void;
}

export function renderTree(root: HTMLElement, doc: PageDoc, registry: SchemaRegistry, selected: string | null, cb: TreeCallbacks) {
  root.innerHTML = '';
  root.append(list(doc.sections, 'sections', 0));

  function list(nodes: Node[], listPath: string, depth: number): HTMLElement {
    const ul = document.createElement('ul');
    ul.className = `ase-tree__list ase-tree__list--d${Math.min(depth, 3)}`;
    ul.dataset.list = listPath;
    nodes.forEach((n, i) => ul.append(item(n, `${listPath}.${i}`, depth)));
    Sortable.create(ul, {
      group: { name: listPath, pull: false, put: false },
      animation: 120,
      handle: '.ase-tree__grip',
      draggable: '.ase-tree__item',
      onEnd: (evt) => { if (evt.oldIndex != null && evt.newIndex != null && evt.oldIndex !== evt.newIndex) cb.onMove(`${listPath}.${evt.oldIndex}`, listPath, evt.newIndex); },
    });
    return ul;
  }
  function item(n: Node, path: string, depth: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ase-tree__item' + (path === selected ? ' is-selected' : '') + (selected?.startsWith(path + '.') ? ' is-open' : '');
    li.dataset.path = path;
    const row = document.createElement('div');
    row.className = 'ase-tree__row';
    const hasKids = !!n.blocks?.length;
    row.innerHTML = `<span class="ase-tree__grip" title="Drag to reorder">⋮⋮</span>${hasKids ? '<button type="button" class="ase-tree__toggle" aria-label="Toggle">▸</button>' : '<span class="ase-tree__toggle ase-tree__toggle--leaf"></span>'}<span class="ase-tree__label"></span>`;
    row.querySelector('.ase-tree__label')!.textContent = nodeLabel(n, registry);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('ase-tree__toggle')) { li.classList.toggle('is-open'); return; }
      cb.onSelect(path);
    });
    li.append(row);
    if (hasKids) li.append(list(n.blocks!, `${path}.blocks`, depth + 1));
    return li;
  }
}
