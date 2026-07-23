import type { EditorState, EditorAction, MapObjectRecord } from '../EditorTypes';

const TILE_SIZE = 16;

export type ObjectActions =
  | Extract<EditorAction, { type: 'SELECT_MAP_OBJECT' }>
  | Extract<EditorAction, { type: 'UPDATE_MAP_OBJECT' }>
  | Extract<EditorAction, { type: 'ADD_PENDING_TERRAIN_PAINT' }>
  | Extract<EditorAction, { type: 'ADD_PENDING_OBJECT_CREATE' }>
  | Extract<EditorAction, { type: 'ADD_PENDING_OBJECT_DELETE' }>
  | Extract<EditorAction, { type: 'REMOVE_PENDING_OBJECT_DELETE' }>
  | Extract<EditorAction, { type: 'ADD_PENDING_OBJECT_UPDATE' }>
  | Extract<EditorAction, { type: 'SET_PENDING_SPAWN' }>
  | Extract<EditorAction, { type: 'CLEAR_PENDING_CHANGES' }>
  | Extract<EditorAction, { type: 'LOAD_MAP_OBJECTS' }>;

function applyPendingObjectDelete(
  state: EditorState,
  action: Extract<EditorAction, { type: 'ADD_PENDING_OBJECT_DELETE' }>,
): Partial<EditorState> {
  const objToDelete = state.mapObjects.find((o) => String(o.id) === String(action.objectId));
  let updatedPending = { ...state.pendingChanges };
  let updatedMapObjects = state.mapObjects;
  let updatedAssets = state.assets;

  if (objToDelete?._pending === 'add') {
    updatedMapObjects = state.mapObjects.filter((o) => String(o.id) !== String(action.objectId));
    updatedPending = {
      ...updatedPending,
      objectsToAdd: updatedPending.objectsToAdd.filter((o) => String(o.id) !== String(action.objectId)),
    };
    const targetX = objToDelete.tileX * TILE_SIZE;
    const targetY = objToDelete.tileY * TILE_SIZE;
    const assetToRemove = state.assets.find((a) => a.x === targetX && a.y === targetY);
    if (assetToRemove) {
      updatedAssets = state.assets.filter((a) => a.id !== assetToRemove.id);
    }
  } else {
    updatedPending = { ...updatedPending, objectsToDelete: [...updatedPending.objectsToDelete, action.objectId] };
  }
  updatedPending = {
    ...updatedPending,
    objectUpdates: updatedPending.objectUpdates.filter((u) => String(u.id) !== String(action.objectId)),
  };
  return { mapObjects: updatedMapObjects, pendingChanges: updatedPending, assets: updatedAssets };
}

function applyPendingObjectUpdate(
  state: EditorState,
  action: Extract<EditorAction, { type: 'ADD_PENDING_OBJECT_UPDATE' }>,
): Partial<EditorState> {
  const existing = state.pendingChanges.objectUpdates.find((u) => String(u.id) === String(action.objectId));
  let objectUpdates: Array<{ id: number | string; updates: Partial<MapObjectRecord> }>;
  if (existing) {
    objectUpdates = state.pendingChanges.objectUpdates.map((u) =>
      String(u.id) === String(action.objectId) ? { ...u, updates: { ...u.updates, ...action.updates } } : u,
    );
  } else {
    objectUpdates = [...state.pendingChanges.objectUpdates, { id: action.objectId, updates: action.updates }];
  }
  const updatedObjects = state.mapObjects.map((o) =>
    String(o.id) === String(action.objectId) ? { ...o, ...action.updates } : o,
  );
  return { mapObjects: updatedObjects, pendingChanges: { ...state.pendingChanges, objectUpdates } };
}

function applyClearPendingChanges(state: EditorState): Partial<EditorState> {
  const idsToDelete = new Set(state.pendingChanges.objectsToDelete.map((id) => String(id)));
  let clearedMapObjects = state.mapObjects;
  let clearedAssets = state.assets;
  if (idsToDelete.size > 0) {
    clearedMapObjects = state.mapObjects.filter((o) => !idsToDelete.has(String(o.id)));
    const deletedPositions = new Set<string>();
    for (const obj of state.mapObjects) {
      if (idsToDelete.has(String(obj.id))) deletedPositions.add(`${obj.tileX * TILE_SIZE},${obj.tileY * TILE_SIZE}`);
    }
    clearedAssets = state.assets.filter((a) => !deletedPositions.has(`${a.x},${a.y}`));
  }
  return {
    mapObjects: clearedMapObjects,
    assets: clearedAssets,
    pendingChanges: {
      terrainPaints: [],
      objectsToAdd: [],
      objectsToDelete: [],
      objectUpdates: [],
      zonesModified: false,
      spawnUpdate: null,
    },
  };
}

export function reduceObject(state: EditorState, action: ObjectActions): Partial<EditorState> | null {
  switch (action.type) {
    case 'SELECT_MAP_OBJECT':
      return { selectedObjectId: action.objectId };
    case 'UPDATE_MAP_OBJECT': {
      const objects = state.mapObjects.map((o) =>
        String(o.id) === String(action.objectId) ? { ...o, ...action.updates } : o,
      );
      return { mapObjects: objects };
    }
    case 'ADD_PENDING_TERRAIN_PAINT':
      return {
        pendingChanges: {
          ...state.pendingChanges,
          terrainPaints: [...state.pendingChanges.terrainPaints, action.paint],
        },
      };
    case 'ADD_PENDING_OBJECT_CREATE':
      return {
        mapObjects: [...state.mapObjects, action.object],
        pendingChanges: {
          ...state.pendingChanges,
          objectsToAdd: [...state.pendingChanges.objectsToAdd, action.object],
        },
      };
    case 'ADD_PENDING_OBJECT_DELETE':
      return applyPendingObjectDelete(state, action);
    case 'REMOVE_PENDING_OBJECT_DELETE':
      return {
        pendingChanges: {
          ...state.pendingChanges,
          objectsToDelete: state.pendingChanges.objectsToDelete.filter((id) => String(id) !== String(action.objectId)),
        },
      };
    case 'ADD_PENDING_OBJECT_UPDATE':
      return applyPendingObjectUpdate(state, action);
    case 'SET_PENDING_SPAWN':
      return {
        spawn: { x: action.x, y: action.y },
        pendingChanges: { ...state.pendingChanges, spawnUpdate: { x: action.x, y: action.y } },
      };
    case 'CLEAR_PENDING_CHANGES':
      return applyClearPendingChanges(state);
    case 'LOAD_MAP_OBJECTS':
      return { mapObjects: action.objects };
  }
  return null;
}
