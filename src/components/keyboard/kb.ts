import update from 'immutability-helper';
import { useEffect, useRef, useState } from 'preact/compat';
import type { KanbanView } from 'src/KanbanView';
import type { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import { getEntityFromPath, moveEntity, updateEntity } from 'src/dnd/util/data';
import type { BoardModifiers } from 'src/helpers/boardModifiers';
import { frontmatterKey } from 'src/parsers/common';
import { getTaskStatusDone, toggleTask } from 'src/parsers/helpers/inlineMetadata';

import type { SearchContextProps } from '../context';
import { maybeCompleteForMove } from '../helpers';
import { Board, DataTypes, Item, Lane } from '../types';

export interface KbSelection {
  laneId: string | null;
  itemId: string | null;
}

export const emptyKbSelection: KbSelection = { laneId: null, itemId: null };

export type KbAction =
  | 'next-lane'
  | 'prev-lane'
  | 'next-card'
  | 'prev-card'
  | 'edit-card'
  | 'clear-selection'
  | 'move-card-up'
  | 'move-card-down'
  | 'move-card-left'
  | 'move-card-right'
  | 'toggle-card'
  | 'new-card'
  | 'archive-card'
  | 'delete-card';

export const kbActionNames: Record<KbAction, string> = {
  'next-lane': 'Keyboard: select next list',
  'prev-lane': 'Keyboard: select previous list',
  'next-card': 'Keyboard: select next card',
  'prev-card': 'Keyboard: select previous card',
  'edit-card': 'Keyboard: edit selected card',
  'clear-selection': 'Keyboard: clear selection',
  'move-card-up': 'Keyboard: move selected card up',
  'move-card-down': 'Keyboard: move selected card down',
  'move-card-left': 'Keyboard: move selected card to previous list',
  'move-card-right': 'Keyboard: move selected card to next list',
  'toggle-card': 'Keyboard: toggle selected card complete',
  'new-card': 'Keyboard: add card to selected list',
  'archive-card': 'Keyboard: archive selected card',
  'delete-card': 'Keyboard: delete selected card',
};

/**
 * Subscribe to a slice of the view's keyboard selection. The component only
 * re-renders when the selected slice changes.
 */
export function useKbSelection<T>(view: KanbanView, selector: (sel: KbSelection) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [value, setValue] = useState<T>(() => selector(view.kbSelection));

  useEffect(() => {
    const handler = (sel: KbSelection) => setValue(selectorRef.current(sel));
    handler(view.kbSelection);
    view.emitter.on('kbSelection', handler);
    return () => {
      view.emitter.off('kbSelection', handler);
    };
  }, [view]);

  return value;
}

/**
 * Toggle an item's checked state. Shared by the checkbox and the keyboard.
 */
export function toggleItemChecked(
  stateManager: StateManager,
  boardModifiers: BoardModifiers,
  path: Path,
  item: Item
) {
  const updates = toggleTask(item, stateManager.file);
  if (updates) {
    const [itemStrings, checkChars, thisIndex] = updates;
    const replacements: Item[] = itemStrings.map((str, i) => {
      const next = stateManager.getNewItem(str, checkChars[i]);
      if (i === thisIndex) next.id = item.id;
      return next;
    });

    boardModifiers.replaceItem(path, replacements);
  } else {
    boardModifiers.updateItem(
      path,
      update(item, {
        data: {
          checkChar: {
            $apply: (v) => {
              return v === ' ' ? getTaskStatusDone() : ' ';
            },
          },
          $toggle: ['checked'],
        },
      })
    );
  }
}

interface KbDeps {
  view: KanbanView;
  stateManager: StateManager;
  boardModifiers: BoardModifiers;
  search: SearchContextProps | null;
}

interface Resolved {
  board: Board;
  lanes: Lane[];
  /** indexes of lanes that can be navigated to */
  visibleLanes: number[];
  laneIndex: number;
  lane: Lane | null;
  /** indexes (within the lane) of the items that are currently shown */
  visibleItems: number[];
  itemIndex: number;
  item: Item | null;
}

function getVisibleItems(lane: Lane, search: SearchContextProps | null): number[] {
  const out: number[] = [];
  lane.children.forEach((item, i) => {
    if (search?.query && !search.items.has(item)) return;
    out.push(i);
  });
  return out;
}

function resolve({ view, stateManager, search }: KbDeps): Resolved | null {
  const board = stateManager.state;
  if (!board || board.data.errors?.length) return null;

  const lanes = board.children;
  const collapse = view.getViewState('list-collapse') || [];
  const visibleLanes: number[] = [];

  lanes.forEach((lane, i) => {
    if (collapse[i]) return;
    if (search?.query && !search.lanes.has(lane)) return;
    visibleLanes.push(i);
  });

  const sel = view.kbSelection;
  let laneIndex = sel.laneId ? lanes.findIndex((l) => l.id === sel.laneId) : -1;
  if (laneIndex >= 0 && !visibleLanes.includes(laneIndex)) laneIndex = -1;

  const lane = laneIndex >= 0 ? lanes[laneIndex] : null;
  const visibleItems = lane ? getVisibleItems(lane, search) : [];

  let itemIndex = lane && sel.itemId ? lane.children.findIndex((i) => i.id === sel.itemId) : -1;
  if (itemIndex >= 0 && !visibleItems.includes(itemIndex)) itemIndex = -1;

  return {
    board,
    lanes,
    visibleLanes,
    laneIndex,
    lane,
    visibleItems,
    itemIndex,
    item: itemIndex >= 0 ? lane.children[itemIndex] : null,
  };
}

function selectInLane(deps: KbDeps, r: Resolved, laneIndex: number, row: number) {
  const lane = r.lanes[laneIndex];
  const visible = getVisibleItems(lane, deps.search);
  const pos = Math.max(0, Math.min(row, visible.length - 1));
  deps.view.setKbSelection({
    laneId: lane.id,
    itemId: visible.length ? lane.children[visible[pos]].id : null,
  });
}

/** Select the first navigable lane when nothing is selected yet. */
function selectInitial(deps: KbDeps, r: Resolved, fromEnd = false): boolean {
  if (!r.visibleLanes.length) return false;
  const laneIndex = fromEnd ? r.visibleLanes[r.visibleLanes.length - 1] : r.visibleLanes[0];
  selectInLane(deps, r, laneIndex, 0);
  return true;
}

function stepLane(deps: KbDeps, r: Resolved, dir: 1 | -1) {
  if (!r.lane) return selectInitial(deps, r, dir === -1);

  const count = r.visibleLanes.length;
  const pos = r.visibleLanes.indexOf(r.laneIndex);
  const next = r.visibleLanes[(pos + dir + count) % count];
  const row = r.itemIndex >= 0 ? r.visibleItems.indexOf(r.itemIndex) : 0;

  selectInLane(deps, r, next, row);
  return true;
}

function stepCard(deps: KbDeps, r: Resolved, dir: 1 | -1) {
  if (!r.lane) return selectInitial(deps, r);
  if (!r.visibleItems.length) return true;

  let pos: number;
  if (r.itemIndex < 0) {
    pos = dir === 1 ? 0 : r.visibleItems.length - 1;
  } else {
    pos = r.visibleItems.indexOf(r.itemIndex) + dir;
    if (pos < 0 || pos >= r.visibleItems.length) return true;
  }

  deps.view.setKbSelection({
    laneId: r.lane.id,
    itemId: r.lane.children[r.visibleItems[pos]].id,
  });
  return true;
}

/**
 * Move the selected card, using the same logic as drag and drop: items moved
 * into a "mark complete" list are completed, and the destination list's sort
 * is cleared. `destination` uses pre-removal indexes (see moveEntity).
 */
function moveSelected(deps: KbDeps, r: Resolved, destination: Path) {
  const { stateManager, view } = deps;
  const source: Path = [r.laneIndex, r.itemIndex];
  const sameLane = destination[0] === source[0];

  // Where the card ends up once it has been removed from its old position
  const landedIndex = sameLane && source[1] < destination[1] ? destination[1] - 1 : destination[1];

  if (sameLane && landedIndex === source[1]) return;

  let landedId: string | null = null;

  stateManager.setState((board) => {
    const entity = getEntityFromPath(board, source);
    if (!entity || entity.type !== DataTypes.Item) return board;

    const complete = (item: Item) =>
      maybeCompleteForMove(stateManager, board, source, stateManager, board, destination, item);

    let newBoard: Board = moveEntity(
      board,
      source,
      destination,
      (e) => complete(e as Item).next,
      (e) => complete(e as Item).replacement
    );

    const destinationParentPath = destination.slice(0, -1);
    const destinationParent = getEntityFromPath(board, destinationParentPath);

    if (destinationParent?.data?.sorted !== undefined) {
      newBoard = updateEntity(newBoard, destinationParentPath, {
        data: { $unset: ['sorted'] },
      });
    }

    // A recurring task leaves a replacement behind in the source lane, which
    // shifts the card down by one when it lands lower in the same lane.
    const lane = newBoard.children[destination[0]];
    landedId = lane?.children[landedIndex]?.id ?? null;

    return newBoard;
  });

  const lane = stateManager.state.children[destination[0]];
  if (lane) {
    view.setKbSelection({ laneId: lane.id, itemId: landedId });
  }
}

function moveCardVertically(deps: KbDeps, r: Resolved, dir: 1 | -1) {
  if (!r.item) return true;

  const pos = r.visibleItems.indexOf(r.itemIndex) + dir;
  if (pos < 0 || pos >= r.visibleItems.length) return true;

  const neighbour = r.visibleItems[pos];
  moveSelected(deps, r, [r.laneIndex, dir === 1 ? neighbour + 1 : neighbour]);
  return true;
}

function moveCardSideways(deps: KbDeps, r: Resolved, dir: 1 | -1) {
  if (!r.item) return true;

  const pos = r.visibleLanes.indexOf(r.laneIndex) + dir;
  if (pos < 0 || pos >= r.visibleLanes.length) return true;

  const target = r.visibleLanes[pos];
  const targetLane = r.lanes[target];
  const targetVisible = getVisibleItems(targetLane, deps.search);
  const row = r.visibleItems.indexOf(r.itemIndex);

  // Keep the card on the same row where possible, otherwise drop it at the end
  const index = row < targetVisible.length ? targetVisible[row] : targetLane.children.length;

  moveSelected(deps, r, [target, index]);
  return true;
}

function removeSelected(deps: KbDeps, r: Resolved, how: 'archive' | 'delete') {
  if (!r.item) return true;

  const pos = r.visibleItems.indexOf(r.itemIndex);
  const neighbour = r.visibleItems[pos + 1] ?? r.visibleItems[pos - 1];
  const nextId = neighbour !== undefined ? r.lane.children[neighbour].id : null;
  const path: Path = [r.laneIndex, r.itemIndex];

  if (how === 'archive') deps.boardModifiers.archiveItem(path);
  else deps.boardModifiers.deleteEntity(path);

  deps.view.setKbSelection({ laneId: r.lane.id, itemId: nextId });
  return true;
}

/**
 * Run a keyboard action. Returns true when the action was handled (and the
 * key event should be swallowed).
 */
export function runKbAction(deps: KbDeps, action: KbAction): boolean {
  const { view, stateManager, boardModifiers } = deps;

  if (view.getViewState(frontmatterKey) === 'table') return false;

  const r = resolve(deps);
  if (!r) return false;

  switch (action) {
    case 'next-lane':
      return stepLane(deps, r, 1);
    case 'prev-lane':
      return stepLane(deps, r, -1);
    case 'next-card':
      return stepCard(deps, r, 1);
    case 'prev-card':
      return stepCard(deps, r, -1);
    case 'clear-selection':
      if (!view.kbSelection.laneId) return false;
      view.setKbSelection(emptyKbSelection);
      return true;
    case 'edit-card':
      if (!r.item) return false;
      view.emitter.emit('kbEditCard', r.item.id);
      return true;
    case 'new-card':
      if (!r.lane) return false;
      view.emitter.emit('kbNewCard', r.lane.id);
      return true;
    case 'toggle-card':
      if (!r.item) return false;
      toggleItemChecked(stateManager, boardModifiers, [r.laneIndex, r.itemIndex], r.item);
      return true;
    case 'move-card-up':
      return moveCardVertically(deps, r, -1);
    case 'move-card-down':
      return moveCardVertically(deps, r, 1);
    case 'move-card-left':
      return moveCardSideways(deps, r, -1);
    case 'move-card-right':
      return moveCardSideways(deps, r, 1);
    case 'archive-card':
      return removeSelected(deps, r, 'archive');
    case 'delete-card':
      return removeSelected(deps, r, 'delete');
  }

  return false;
}

function keyToAction(e: KeyboardEvent): KbAction | null {
  if (e.metaKey || e.ctrlKey) return null;

  if (e.altKey) {
    if (e.shiftKey) return null;
    switch (e.key) {
      case 'ArrowUp':
        return 'move-card-up';
      case 'ArrowDown':
        return 'move-card-down';
      case 'ArrowLeft':
        return 'move-card-left';
      case 'ArrowRight':
        return 'move-card-right';
    }
    return null;
  }

  if (e.key === 'Tab') return e.shiftKey ? 'prev-lane' : 'next-lane';
  if (e.shiftKey) return null;

  switch (e.key) {
    case 'ArrowDown':
      return 'next-card';
    case 'ArrowUp':
      return 'prev-card';
    case 'Enter':
      return 'edit-card';
    case 'Escape':
      return 'clear-selection';
    case ' ':
      return 'toggle-card';
    case 'n':
      return 'new-card';
  }

  return null;
}

const ignoreTargets = [
  'input:not([type="checkbox"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.cm-editor',
  '.modal-container',
  '.menu',
  '.prompt',
  '.suggestion-container',
  '.popover',
].join(', ');

const blockingOverlays = '.modal-container, .menu, .prompt, .suggestion-container';

function shouldHandleKey(view: KanbanView, e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  if (view.app.workspace.activeLeaf !== view.leaf) return false;

  const doc = view.containerEl.ownerDocument;
  const target = e.target as HTMLElement | null;

  if (!target || !target.closest) return false;
  // Something is being typed into, or a menu/modal owns the keyboard
  if (target.closest(ignoreTargets)) return false;
  // Let Enter and Space activate a focused button or link as usual
  if ((e.key === 'Enter' || e.key === ' ') && target.closest('button, a, [role="button"], input')) {
    return false;
  }
  if (doc.querySelector(blockingOverlays)) return false;
  // Focus is somewhere else in the app (sidebar, another pane, the tab bar)
  if (target !== doc.body && !view.containerEl.contains(target)) return false;

  return true;
}

/**
 * Wire up keyboard navigation for a board: Tab/Shift+Tab between lists,
 * arrows between cards, plus actions on the selected card.
 */
export function useKeyboardNav(deps: KbDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const { view } = deps;

  useEffect(() => {
    const win = view.getWindow();

    const onKeyDown = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      if (!shouldHandleKey(view, e)) return;

      if (runKbAction(depsRef.current, action)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onAction = (action: KbAction) => {
      runKbAction(depsRef.current, action);
    };

    win.addEventListener('keydown', onKeyDown, true);
    view.emitter.on('kbAction', onAction);

    return () => {
      win.removeEventListener('keydown', onKeyDown, true);
      view.emitter.off('kbAction', onAction);
    };
  }, [view]);
}
