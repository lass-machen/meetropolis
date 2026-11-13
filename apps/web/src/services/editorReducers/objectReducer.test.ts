/**
 * objectReducer Tests: deleting an object must remove only its own record and asset.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorService } from '../EditorService';
import { completePendingTerrainDrag, stampPendingAsset } from '../editorPendingPlacement';
import type { Asset, MapObjectRecord, PackItem } from '../EditorTypes';

const chair: PackItem = {
  packUuid: 'pack-a',
  itemId: 'chair',
  key: 'pack-a:chair',
  category: 'objects',
  dataUrl: 'data:image/png;base64,chair',
  width: 16,
  height: 16,
  collide: false,
};

const table: PackItem = { ...chair, itemId: 'table', key: 'pack-a:table', dataUrl: 'data:image/png;base64,table' };
const sofa: PackItem = { ...chair, itemId: 'sofa', key: 'pack-a:sofa', dataUrl: 'data:image/png;base64,sofa' };

// Test shape: pending create with a required clientAssetId. The production field
// optional in MapObjectRecord so that loaded server records without it stay valid.
type PendingCreateRecord = MapObjectRecord & { clientAssetId: string };

// Mirrors stampPendingAsset in editorPendingPlacement.ts: the asset and the
// pending object are created from the same selected item at the same tile.
// Returns the asset that PLACE_ASSET appended, so tests can address it by identity.
function stampObject(item: PackItem, tileX: number, tileY: number, objectId: number): Asset {
  EditorService.dispatch({ type: 'SELECT_ASSET', asset: item });
  const assetCountBefore = EditorService.getState().assets.length;
  EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });
  const placed = EditorService.getState().assets.slice(assetCountBefore);
  if (placed.length !== 1) throw new Error('PLACE_ASSET must append exactly one asset');
  const asset = placed[0];

  const object: PendingCreateRecord = {
    id: objectId,
    assetPackUuid: item.packUuid,
    itemId: item.itemId,
    category: 'objects',
    tileX,
    tileY,
    width: 16,
    height: 16,
    collide: false,
    zIndex: 0,
    scaleFactor: 1,
    rotation: 0,
    _pending: 'add',
    clientAssetId: asset.id,
  };
  EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_CREATE', object });
  return asset;
}

// The types link an object to its asset only through position and item identity,
// so the test looks up each asset by its distinct itemId.
function assetOf(itemId: string): Asset {
  const asset = EditorService.getState().assets.find((a) => a.itemId === itemId);
  if (!asset) throw new Error(`no asset with itemId ${itemId}`);
  return asset;
}

describe('objectReducer: ADD_PENDING_OBJECT_DELETE', () => {
  beforeEach(() => {
    EditorService.reset();
  });

  it('removes only the deleted object and its own asset when two objects share a tile', () => {
    stampObject(chair, 3, 4, -101);
    stampObject(table, 3, 4, -102);

    const chairAsset = assetOf('chair');
    const tableAsset = assetOf('table');
    expect(chairAsset.id).not.toBe(tableAsset.id);
    expect(chairAsset.x).toBe(tableAsset.x);
    expect(chairAsset.y).toBe(tableAsset.y);

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: -102 });

    const state = EditorService.getState();
    expect(state.mapObjects.map((o) => o.id)).toEqual([-101]);
    expect(state.pendingChanges.objectsToAdd.map((o) => o.id)).toEqual([-101]);
    expect(state.assets.map((a) => a.id)).toEqual([chairAsset.id]);
  });

  it('removes only the asset at the deleted object position when objects sit on different tiles', () => {
    stampObject(chair, 3, 4, -101);
    stampObject(sofa, 7, 1, -103);

    const chairAsset = assetOf('chair');

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: -103 });

    const state = EditorService.getState();
    expect(state.mapObjects.map((o) => o.id)).toEqual([-101]);
    expect(state.assets.map((a) => a.id)).toEqual([chairAsset.id]);
  });

  it('removes only the second instance when two identical items share a tile', () => {
    const first = stampObject(chair, 3, 4, -101);
    const second = stampObject(chair, 3, 4, -102);
    expect(second.id).not.toBe(first.id);

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: -102 });

    const state = EditorService.getState();
    expect(state.mapObjects.map((o) => o.id)).toEqual([-101]);
    expect(state.pendingChanges.objectsToAdd.map((o) => o.id)).toEqual([-101]);
    expect(state.assets.map((a) => a.id)).toEqual([first.id]);
  });

  it('removes the asset of a deleted instance even after that instance was moved', () => {
    const first = stampObject(chair, 3, 4, -101);
    const second = stampObject(chair, 3, 4, -102);
    expect(second.id).not.toBe(first.id);

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_UPDATE', objectId: -102, updates: { tileX: 7, tileY: 1 } });
    expect(EditorService.getState().mapObjects.find((o) => o.id === -102)).toMatchObject({ tileX: 7, tileY: 1 });

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: -102 });

    const state = EditorService.getState();
    expect(state.mapObjects.map((o) => o.id)).toEqual([-101]);
    expect(state.pendingChanges.objectsToAdd.map((o) => o.id)).toEqual([-101]);
    expect(state.pendingChanges.objectUpdates).toEqual([]);
    expect(state.assets.map((a) => a.id)).toEqual([first.id]);
  });

  it('maps a 2x2 terrain drag through the productive helper and deletes only the top-right instance asset', () => {
    const grass: PackItem = {
      ...chair,
      itemId: 'grass',
      key: 'pack-a:grass',
      category: 'terrain',
      dataUrl: 'data:image/png;base64,grass',
    };
    EditorService.dispatch({ type: 'SELECT_ASSET', asset: grass });
    EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX: 3, tileY: 4 });

    const setup = EditorService.getState();
    if (!setup.pendingAsset || !setup.dragState) throw new Error('drag setup must provide pendingAsset and dragState');
    completePendingTerrainDrag(4, 5, setup.pendingAsset, setup.dragState);

    const placed = EditorService.getState();
    expect(placed.mapObjects).toHaveLength(4);
    expect(placed.pendingChanges.objectsToAdd).toHaveLength(4);
    expect(placed.assets).toHaveLength(4);

    // Each instance must match its asset exactly via clientAssetId, with matching
    // tile position (TILE_SIZE 16). A swapped
    // x/y loop order between reducer and helper shows up here.
    const TILE_SIZE = 16;
    for (const obj of placed.mapObjects) {
      const linked = placed.assets.find((a) => a.id === obj.clientAssetId);
      if (!linked) throw new Error(`no asset linked to object ${String(obj.id)}`);
      expect(linked.x).toBe(obj.tileX * TILE_SIZE);
      expect(linked.y).toBe(obj.tileY * TILE_SIZE);
    }

    // Delete the upper right instance (4,4): deliberately not the one in every
    // Reihenfolge stabile Ecke, sondern per Kachel nachgeschlagen.
    const topRight = placed.mapObjects.find((o) => o.tileX === 4 && o.tileY === 4);
    if (!topRight) throw new Error('expected an instance at tile (4,4)');
    const removedAssetId = topRight.clientAssetId;
    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: topRight.id });

    const state = EditorService.getState();
    expect(state.mapObjects).toHaveLength(3);
    expect(state.pendingChanges.objectsToAdd).toHaveLength(3);
    expect(state.assets).toHaveLength(3);
    expect(state.assets.find((a) => a.id === removedAssetId)).toBeUndefined();
    const remainingIds = new Set(state.mapObjects.map((o) => String(o.id)));
    expect(state.pendingChanges.objectsToAdd.every((o) => remainingIds.has(String(o.id)))).toBe(true);
    for (const obj of state.mapObjects) {
      expect(state.assets.some((a) => a.id === obj.clientAssetId)).toBe(true);
    }
  });

  it('assigns unique negative IDs that decrease by one per instance across stamp, 2x2 drag and stamp', () => {
    // Erster produktiver Stempel.
    EditorService.dispatch({ type: 'SELECT_ASSET', asset: chair });
    const beforeFirst = EditorService.getState();
    if (!beforeFirst.pendingAsset) throw new Error('SELECT_ASSET must provide pendingAsset');
    stampPendingAsset(2, 3, beforeFirst.pendingAsset);

    // Production 2x2 drag on tiles with a row break (ty flows into the
    // old ID formula, the clock is not mocked).
    const grass: PackItem = {
      ...chair,
      itemId: 'grass',
      key: 'pack-a:grass',
      category: 'terrain',
      dataUrl: 'data:image/png;base64,grass',
    };
    EditorService.dispatch({ type: 'SELECT_ASSET', asset: grass });
    EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX: 5, tileY: 5 });
    const dragSetup = EditorService.getState();
    if (!dragSetup.pendingAsset || !dragSetup.dragState) {
      throw new Error('drag setup must provide pendingAsset and dragState');
    }
    completePendingTerrainDrag(6, 6, dragSetup.pendingAsset, dragSetup.dragState);

    // Zweiter produktiver Stempel.
    EditorService.dispatch({ type: 'SELECT_ASSET', asset: chair });
    const beforeSecond = EditorService.getState();
    if (!beforeSecond.pendingAsset) throw new Error('SELECT_ASSET must provide pendingAsset');
    stampPendingAsset(1, 1, beforeSecond.pendingAsset);

    // 1 Stempel + 4 Drag-Instanzen + 1 Stempel in Erzeugungsreihenfolge.
    const ids = EditorService.getState().mapObjects.map((o) => o.id);
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeLessThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1];
      const curr = ids[i];
      if (typeof prev !== 'number' || typeof curr !== 'number') {
        throw new Error('expected consecutive numeric ids');
      }
      expect(curr).toBe(prev - 1);
    }
  });

  it('setzt die Negativ-ID-Sequenz nach EditorService.reset ohne Wiederverwendung fort', () => {
    EditorService.dispatch({ type: 'SELECT_ASSET', asset: chair });
    const beforeReset = EditorService.getState();
    if (!beforeReset.pendingAsset) throw new Error('SELECT_ASSET must provide pendingAsset');
    stampPendingAsset(0, 0, beforeReset.pendingAsset);
    const idsBefore = EditorService.getState().mapObjects.map((o) => o.id);
    expect(idsBefore).toHaveLength(1);
    const lastBeforeReset = idsBefore[idsBefore.length - 1];
    if (typeof lastBeforeReset !== 'number') throw new Error('expected one numeric object before reset');

    EditorService.reset();

    EditorService.dispatch({ type: 'SELECT_ASSET', asset: chair });
    const afterReset = EditorService.getState();
    if (!afterReset.pendingAsset) throw new Error('SELECT_ASSET must provide pendingAsset');
    stampPendingAsset(0, 0, afterReset.pendingAsset);
    const idsAfter = EditorService.getState().mapObjects.map((o) => o.id);
    expect(idsAfter).toHaveLength(1);
    const nextId = idsAfter[0];
    if (typeof nextId !== 'number') throw new Error('expected one numeric object after reset');
    expect(Number.isInteger(nextId)).toBe(true);
    expect(nextId).toBeLessThan(0);
    expect(nextId).toBe(lastBeforeReset - 1);
  });

  it('keeps drag A, drag B and stamp instances uniquely distinguishable at a 1000 ms offset', () => {
    // Time simulation, not a production stub: only freezes the clock, all
    // helpers and the EditorService stay production code.
    vi.useFakeTimers();
    try {
      const terrain: PackItem = {
        ...chair,
        itemId: 'grass',
        key: 'pack-a:grass',
        category: 'terrain',
        dataUrl: 'data:image/png;base64,grass',
      };
      const t = new Date('2026-01-15T12:00:00.000Z').getTime();

      // Drag A: only tile (0,1) at the fixed time t.
      vi.setSystemTime(t);
      EditorService.dispatch({ type: 'SELECT_ASSET', asset: terrain });
      EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX: 0, tileY: 1 });
      const setupA = EditorService.getState();
      if (!setupA.pendingAsset || !setupA.dragState) {
        throw new Error('drag setup A must provide pendingAsset and dragState');
      }
      completePendingTerrainDrag(0, 1, setupA.pendingAsset, setupA.dragState);

      // Drag B: only tile (0,0) at exactly t + 1000 ms.
      vi.setSystemTime(t + 1000);
      EditorService.dispatch({ type: 'SELECT_ASSET', asset: terrain });
      EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX: 0, tileY: 0 });
      const setupB = EditorService.getState();
      if (!setupB.pendingAsset || !setupB.dragState) {
        throw new Error('drag setup B must provide pendingAsset and dragState');
      }
      completePendingTerrainDrag(0, 0, setupB.pendingAsset, setupB.dragState);

      // Stamp at t + 1000 ms. The legacy formulas -Date.now() and
      // -(Date.now()+ty*1000+tx) collide here deterministically.
      EditorService.dispatch({ type: 'SELECT_ASSET', asset: chair });
      const beforeStamp = EditorService.getState();
      if (!beforeStamp.pendingAsset) throw new Error('SELECT_ASSET must provide pendingAsset');
      stampPendingAsset(2, 2, beforeStamp.pendingAsset);

      const ids = EditorService.getState().mapObjects.map((o) => o.id);
      expect(ids).toHaveLength(3);
      for (const id of ids) {
        if (typeof id !== 'number') throw new Error('expected numeric temp ids');
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeLessThan(0);
      }
      expect(new Set(ids).size).toBe(ids.length);

      // Targeted deletion of exactly one instance without losing the others.
      const [deleted, ...kept] = ids;
      if (typeof deleted !== 'number') throw new Error('expected numeric temp id');
      EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: deleted });

      const state = EditorService.getState();
      expect(state.mapObjects).toHaveLength(2);
      expect(state.pendingChanges.objectsToAdd).toHaveLength(2);
      expect(state.mapObjects.map((o) => o.id)).toEqual(kept);
      for (const obj of state.mapObjects) {
        expect(state.assets.some((a) => a.id === obj.clientAssetId)).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears only the deleted saved record once the pending changes are cleared', () => {
    // Server-shaped records: positive ids, no clientAssetId, no _pending marker.
    const savedChair: MapObjectRecord = {
      id: 1001,
      assetPackUuid: 'pack-a',
      itemId: 'chair',
      category: 'objects',
      tileX: 3,
      tileY: 4,
      width: 16,
      height: 16,
      collide: false,
      zIndex: 0,
      scaleFactor: 1,
    };
    EditorService.dispatch({ type: 'LOAD_MAP_OBJECTS', objects: [savedChair, { ...savedChair, id: 1002 }] });

    EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: 1002 });

    const beforeClear = EditorService.getState();
    expect(beforeClear.pendingChanges.objectsToDelete).toEqual([1002]);
    expect(beforeClear.mapObjects.map((o) => o.id)).toEqual([1001, 1002]);

    EditorService.dispatch({ type: 'CLEAR_PENDING_CHANGES' });

    const state = EditorService.getState();
    expect(state.mapObjects.map((o) => o.id)).toEqual([1001]);
    expect(state.pendingChanges.objectsToDelete).toEqual([]);
  });
});
