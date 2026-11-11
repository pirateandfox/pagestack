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
  root.innerHTML = `<div class="ps-panel__head"><span>Add block</span><button type="button" class="ps-iconbtn" aria-label="Close">${icons.close}</button></div>
    <div class="ps-inserter__search"><input type="search" placeholder="Search blocks and patterns" aria-label="Search blocks and patterns" /></div>
    <p class="ps-inserter__where ps-muted"></p><div class="ps-inserter__results"></div>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const results = root.querySelector<HTMLElement>('.ps-inserter__results')!;
  root.querySelector('.ps-inserter__where')!.textContent = o.where();
  root.querySelector('button')!.addEventListener('click', o.onClose);

  const draw = () => {
    const found = searchItems(o.items(), input.value);
    results.innerHTML = '';
    if (!found.length) { const p = document.createElement('p'); p.className = 'ps-muted ps-inserter__none'; p.textContent = 'No blocks found.'; results.append(p); return; }
    for (const g of groupItems(found)) {
      const h = document.createElement('h3'); h.textContent = g.category;
      const grid = document.createElement('div'); grid.className = 'ps-inserter__grid';
      for (const item of g.items) grid.append(tile(item));
      results.append(h, grid);
    }
  };
  const tile = (item: InsertItem) => {
    const wrap = document.createElement('div'); wrap.className = 'ps-tile';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ps-tile__main'; if (item.description) b.title = item.description;
    b.innerHTML = item.type ? icons.block : icons.pattern;
    const name = document.createElement('span'); name.textContent = item.label; b.append(name);
    b.addEventListener('click', () => o.onPick(item));
    wrap.append(b);
    if (item.savedId) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'ps-tile__delete'; x.setAttribute('aria-label', `Delete ${item.label}`); x.innerHTML = icons.close;
      x.addEventListener('click', () => o.onDeleteSaved(item));
      wrap.append(x);
    }
    return wrap;
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); results.querySelector<HTMLElement>('.ps-tile__main')?.click(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); o.onClose(); }
  });
  draw();
  input.focus();
}
