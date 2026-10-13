import { TestBed } from '@angular/core/testing';
import { findItem } from './data/catalog';
import { cellKey } from './plan/plan-document';
import { PlannerStore } from './planner-store';

describe('PlannerStore', () => {
  let store: PlannerStore;

  beforeEach(async () => {
    localStorage.clear();
    store = TestBed.inject(PlannerStore);
    // The greenhouse interior has no restriction data, so the whole map is open.
    await store.newPlan('greenhouse');
    store.selectItem(findItem('parsnip')!);
    store.paint({ x: 2, y: 2, width: 3, height: 3 });
    store.selectItem(findItem('sprinkler')!);
    store.paint({ x: 3, y: 3, width: 1, height: 1 });
  });

  it('selects the tiles and objects in an area, and moves them together', () => {
    store.selectArea({ x: 2, y: 2, width: 3, height: 3 });
    expect(store.selection().objects).toHaveLength(1);
    expect(store.selection().tiles).toHaveLength(8);
    expect(store.moveSelection(2, 1)).toBeNull();
    expect(store.doc.tileAt(2, 2)).toBeNull();
    expect(store.doc.tileAt(4, 3)).toBe('parsnip');
    expect(store.doc.objectAt(5, 4)?.itemId).toBe('sprinkler');
    expect(store.selection().tiles).toContain(cellKey(6, 5));
    store.undo();
    expect(store.doc.tileAt(2, 2)).toBe('parsnip');
  });

  it('pastes copies of the selection, and selects the copy', () => {
    store.selectArea({ x: 2, y: 2, width: 3, height: 3 });
    expect(store.copySelection()?.tiles[0]).toEqual({ x: 0, y: 0, itemId: 'parsnip' });
    expect(store.startPasting()).toBe(true);
    expect(store.tool()).toBe('brush');
    expect(store.pasteAt(10, 2)).toBeNull();
    expect(store.doc.tileAt(10, 2)).toBe('parsnip');
    expect(store.doc.objectAt(11, 3)?.itemId).toBe('sprinkler');
    expect(store.doc.tileCount).toBe(16);
    expect(store.selection().objects).toEqual([store.doc.objectAt(11, 3)!.uid]);
    // Overlapping the copy it just made doesn't fit.
    expect(store.pasteAt(11, 2)).toEqual({ itemId: 'parsnip', reason: { kind: 'object', itemId: 'sprinkler' } });
  });

  it('goes back to the tool it was using when pasting stops', () => {
    store.tool.set('select');
    store.selectArea({ x: 2, y: 2, width: 3, height: 3 });
    store.copySelection();
    store.startPasting();
    store.stopPasting();
    expect(store.pasting()).toBe(false);
    expect(store.tool()).toBe('select');
  });

  it('cuts the selection', () => {
    store.selectArea({ x: 2, y: 2, width: 3, height: 3 });
    store.cutSelection();
    expect(store.doc.tileCount).toBe(0);
    expect(store.doc.objectCount).toBe(0);
    expect(store.clipboard()?.objects).toHaveLength(1);
  });

  it('drops edited-away things from the selection', () => {
    store.selectArea({ x: 2, y: 2, width: 3, height: 3 });
    store.erase({ x: 2, y: 2, width: 1, height: 1 });
    expect(store.selection().tiles).toHaveLength(7);
  });
});
