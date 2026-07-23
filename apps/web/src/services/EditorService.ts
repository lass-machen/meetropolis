/**
 * EditorService: single source of truth for the map editor.
 *
 * Architecture principles:
 * - Immutable state pattern.
 * - Explicit actions for every operation.
 * - No error swallowing.
 * - Observer pattern for state updates.
 *
 * Reducers for individual domains live in `editorReducers/` and are routed
 * by the service singleton based on the incoming action.
 */

import { logger } from '../lib/logger';
import type { EditorState, EditorAction, EditorListener } from './EditorTypes';
import { reduceZone, type ZoneActions } from './editorReducers/zoneReducer';
import { reduceAsset, type AssetActions } from './editorReducers/assetReducer';
import { reduceObject, type ObjectActions } from './editorReducers/objectReducer';
import { reduceTile, type TileActions } from './editorReducers/tileReducer';

// Re-export all types so existing imports from './EditorService' keep working
export type {
  EditorTool,
  EditorCategory,
  Zone,
  Asset,
  PackItem,
  AutotilePackItem,
  Tileset,
  MapObjectRecord,
  TerrainPaintOp,
  PendingChanges,
  ViewToggles,
  EditorState,
  EditorAction,
  EditorListener,
} from './EditorTypes';

const ZONE_ACTIONS = new Set<EditorAction['type']>([
  'START_ZONE_DRAG',
  'UPDATE_ZONE_DRAG',
  'COMPLETE_ZONE',
  'DELETE_ZONE',
  'START_EDIT_ZONE',
  'UPDATE_ZONE_NAME',
  'SET_ZONE_NAME',
  'UPDATE_ZONE_TYPE',
  'UPDATE_ZONE_PORTAL',
  'MARK_ZONES_MODIFIED',
]);

const ASSET_ACTIONS = new Set<EditorAction['type']>([
  'SELECT_ASSET',
  'PLACE_ASSET',
  'START_ASSET_DRAG',
  'UPDATE_ASSET_DRAG',
  'COMPLETE_ASSET_DRAG',
  'DELETE_ASSET',
  'ADD_PACK_ITEMS',
  'REGISTER_TILESET',
  'LOAD_TILESETS',
  'ROTATE_PENDING_ASSET',
  'SELECT_WALL_TYPE',
  'SET_AUTOTILE_ITEMS',
  'SELECT_TILE_REF',
]);

const OBJECT_ACTIONS = new Set<EditorAction['type']>([
  'SELECT_MAP_OBJECT',
  'UPDATE_MAP_OBJECT',
  'ADD_PENDING_TERRAIN_PAINT',
  'ADD_PENDING_OBJECT_CREATE',
  'ADD_PENDING_OBJECT_DELETE',
  'REMOVE_PENDING_OBJECT_DELETE',
  'ADD_PENDING_OBJECT_UPDATE',
  'SET_PENDING_SPAWN',
  'CLEAR_PENDING_CHANGES',
  'LOAD_MAP_OBJECTS',
]);

const TILE_ACTIONS = new Set<EditorAction['type']>(['START_TILE_DRAG', 'UPDATE_TILE_DRAG', 'COMPLETE_TILE_DRAG']);

function createInitialState(): EditorState {
  return {
    active: false,
    tool: 'select',
    category: 'general',
    zones: [],
    editingZoneIndex: null,
    zoneName: '',
    assets: [],
    pendingAsset: null,
    packItems: [],
    autotileItems: [],
    tilesets: [],
    spawn: null,
    gridVisible: false,
    selectedWallTypeId: 0,
    dragState: null,
    selectedTileRefId: 0,
    selectedTilesetSlot: 0,
    selectedObjectId: null,
    mapObjects: [],
    pendingChanges: {
      terrainPaints: [],
      objectsToAdd: [],
      objectsToDelete: [],
      objectUpdates: [],
      zonesModified: false,
      spawnUpdate: null,
    },
    viewToggles: { collision: false, zones: false, objects: true, grid: false },
  };
}

function reduceCore(state: EditorState, action: EditorAction): Partial<EditorState> | null {
  switch (action.type) {
    case 'ACTIVATE_EDITOR':
      return {
        active: true,
        category: action.category || 'terrain',
        tool: action.category === 'zones' ? 'zone' : 'select',
      };
    case 'DEACTIVATE_EDITOR':
      return { active: false, dragState: null, pendingAsset: null, selectedObjectId: null };
    case 'SET_TOOL':
      return { tool: action.tool, dragState: null };
    case 'SET_CATEGORY':
      return {
        category: action.category,
        tool: action.category === 'zones' ? 'zone' : action.category === 'autotiles' ? 'wall' : 'select',
        pendingAsset: null,
        dragState: null,
      };
    case 'SET_SPAWN':
      logger.debug('[EditorService] SET_SPAWN', action);
      return { spawn: { x: action.x, y: action.y } };
    case 'CLEAR_SPAWN':
      return { spawn: null };
    case 'SET_TERRAIN_COLOR':
      return { terrainColor: action.color };
    case 'TOGGLE_GRID':
      return { gridVisible: !state.gridVisible };
    case 'SET_BACKGROUND_COLOR':
      return { backgroundColor: action.color };
    case 'LOAD_STATE':
      return action.state;
    case 'CLEAR_DRAG':
      return { dragState: null };
    case 'TOGGLE_VIEW':
      return { viewToggles: { ...state.viewToggles, [action.key]: !state.viewToggles[action.key] } };
  }
  return null;
}

class EditorServiceClass {
  private state: EditorState;
  private listeners: Set<EditorListener> = new Set();

  constructor() {
    this.state = createInitialState();
  }

  public getState(): EditorState {
    return this.state;
  }

  public subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private updateState(updates: Partial<EditorState>): void {
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  public dispatch(action: EditorAction): void {
    if (ZONE_ACTIONS.has(action.type)) {
      const u = reduceZone(this.state, action as ZoneActions);
      if (u) this.updateState(u);
      return;
    }
    if (ASSET_ACTIONS.has(action.type)) {
      const u = reduceAsset(this.state, action as AssetActions);
      if (u) this.updateState(u);
      return;
    }
    if (OBJECT_ACTIONS.has(action.type)) {
      const u = reduceObject(this.state, action as ObjectActions);
      if (u) this.updateState(u);
      return;
    }
    if (TILE_ACTIONS.has(action.type)) {
      const { update, followups } = reduceTile(this.state, action as TileActions);
      this.updateState(update);
      if (followups) for (const f of followups) this.dispatch(f);
      return;
    }
    const u = reduceCore(this.state, action);
    if (u) {
      this.updateState(u);
      return;
    }
    // Exhaustive check: the type system enforces this, but guard at runtime too.
    throw new Error(`Unknown action type: ${(action as { type?: string }).type ?? '<missing>'}`);
  }

  public hasPendingChanges(): boolean {
    const p = this.state.pendingChanges;
    return (
      p.terrainPaints.length > 0 ||
      p.objectsToAdd.length > 0 ||
      p.objectsToDelete.length > 0 ||
      p.objectUpdates.length > 0 ||
      p.zonesModified ||
      p.spawnUpdate !== null
    );
  }

  public getPendingChangesCount(): number {
    const p = this.state.pendingChanges;
    return (
      p.terrainPaints.length +
      p.objectsToAdd.length +
      p.objectsToDelete.length +
      p.objectUpdates.length +
      (p.zonesModified ? 1 : 0) +
      (p.spawnUpdate ? 1 : 0)
    );
  }

  public reset(): void {
    this.state = createInitialState();
    this.notify();
  }
}

export const EditorService = new EditorServiceClass();
