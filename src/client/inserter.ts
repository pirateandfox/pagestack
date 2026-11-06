// The block inserter (left panel): search everything that can go at the insertion point, grouped
// by category. Click to insert.
import type { InsertItem } from '../core/insert';
import { groupItems, searchItems } from '../core/insert';
import { icons } from './icons';

export interface InserterOptions {
  items: () => InsertItem[];
  /** Words for where the block will land ("Insert into Hero"). */
  where: () => string;
  onPick: (item: InsertItem) => void;
  onDeleteSaved: (item: InsertItem) => void;
  onClose: () => void;
}

export function renderInserter(root: HTMLElement, o: InserterOptions) {
  root.innerHTML = `<div class="ase-panel__head"><span>Add block</span><button type="button" class="ase-iconbtn" aria-label="Close">${icons.close}</button></div>
    <div class="ase-inserter__search"><input type="search" placeholder="Search blocks and patterns" aria-label="Search blocks and patterns" /></div>
    <p class="ase-inserter__where ase-muted"></p><div class="ase-inserter__results"></div>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const results = root.querySelector<HTMLElement>('.ase-inserter__results')!;
  root.querySelector('.ase-inserter__where')!.textContent = o.where();
  root.querySelector('button')!.addEventListener('click', o.onClose);

  const draw = () => {
    const found = searchItems(o.items(), input.value);
    results.innerHTML = '';
    if (!found.length) { const p = document.createElement('p'); p.className = 'ase-muted ase-inserter__none'; p.textContent = 'No blocks found.'; results.append(p); return; }
    for (const g of groupItems(found)) {
      const h = document.createElement('h3'); h.textContent = g.category;
      const grid = document.createElement('div'); grid.className = 'ase-inserter__grid';
      for (const item of g.items) grid.append(tile(item));
      results.append(h, grid);
    }
  };
  const tile = (item: InsertItem) => {
    const wrap = document.createElement('div'); wrap.className = 'ase-tile';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ase-tile__main'; if (item.description) b.title = item.description;
    b.innerHTML = item.type ? icons.block : icons.pattern;
    const name = document.createElement('span'); name.textContent = item.label; b.append(name);
    b.addEventListener('click', () => o.onPick(item));
    wrap.append(b);
    if (item.savedId) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'ase-tile__delete'; x.setAttribute('aria-label', `Delete ${item.label}`); x.innerHTML = icons.close;
      x.addEventListener('click', () => o.onDeleteSaved(item));
      wrap.append(x);
    }
    return wrap;
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); results.querySelector<HTMLElement>('.ase-tile__main')?.click(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); o.onClose(); }
  });
  draw();
  input.focus();
}
