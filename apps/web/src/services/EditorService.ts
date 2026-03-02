/**
 * EditorService - Single Source of Truth für den Map-Editor
 *
 * Architektur-Prinzipien:
 * - Immutable State Pattern
 * - Explizite Actions für alle Operationen
 * - Keine Error-Swallowing
 * - Observer Pattern für State-Updates
 */

import { logger } from '../lib/logger';
import type { EditorState, EditorAction, EditorListener, Zone, Asset, MapObjectRecord } from './EditorTypes';

// Re-export all types so existing imports from './EditorService' keep working
export type { EditorTool, EditorCategory, Zone, Asset, PackItem, Tileset, MapObjectRecord, TerrainPaintOp, PendingChanges, ViewToggles, EditorState, EditorAction, EditorListener } from './EditorTypes';

class EditorServiceClass {
  private state: EditorState;
  private listeners: Set<EditorListener> = new Set();

  constructor() {
    this.state = this.createInitialState();
  }

  private createInitialState(): EditorState {
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
      tilesets: [],
      spawn: null,
      gridVisible: false,
      selectedWallTypeId: 0,
      dragState: null,
      selectedTileRefId: 0,
      selectedTilesetSlot: 0,
      selectedObjectId: null,
      mapObjects: [],
      pendingChanges: { terrainPaints: [], objectsToAdd: [], objectsToDelete: [], objectUpdates: [], zonesModified: false, spawnUpdate: null },
      viewToggles: { collision: false, zones: false, objects: true, grid: false },
    };
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
    this.listeners.forEach(listener => listener(this.state));
  }

  private updateState(updates: Partial<EditorState>): void {
    this.state = { ...this.state, ...updates };

    this.notify();
  }

  public dispatch(action: EditorAction): void {
    switch (action.type) {
      case 'ACTIVATE_EDITOR':
        this.updateState({
          active: true,
          category: action.category || 'terrain',
          tool: action.category === 'zones' ? 'zone' : 'select', // Reverted to original logic
        });
        break;

      case 'DEACTIVATE_EDITOR':
        this.updateState({
          active: false,
          dragState: null,
          pendingAsset: null,
          selectedObjectId: null,
        });
        break;

      case 'SET_TOOL':
        this.updateState({ tool: action.tool, dragState: null });
        break;

      case 'SET_CATEGORY':
        this.updateState({
          category: action.category,
          tool: action.category === 'zones' ? 'zone' : (action.category === 'autotiles' ? 'wall' : 'select'),
          pendingAsset: null,
          dragState: null,
        });
        break;

      case 'START_ZONE_DRAG':
        this.updateState({
          dragState: {
            startTileX: action.tileX,
            startTileY: action.tileY,
            endTileX: action.tileX,
            endTileY: action.tileY,
          },
        });
        break;

      case 'UPDATE_ZONE_DRAG':
        if (!this.state.dragState) {
          throw new Error('Cannot update drag: no drag in progress');
        }
        this.updateState({
          dragState: {
            ...this.state.dragState,
            endTileX: action.tileX,
            endTileY: action.tileY,
          },
        });
        break;

      case 'COMPLETE_ZONE': {
        if (!this.state.dragState) {
          throw new Error('Cannot complete zone: no drag in progress');
        }

        const { startTileX, startTileY } = this.state.dragState;
        const tileSize = 16;
        const x0 = Math.min(startTileX, action.tileX) * tileSize;
        const y0 = Math.min(startTileY, action.tileY) * tileSize;
        const x1 = (Math.max(startTileX, action.tileX) + 1) * tileSize;
        const y1 = (Math.max(startTileY, action.tileY) + 1) * tileSize;

        const zone: Zone = {
          name: action.name || this.state.zoneName || `Zone ${this.state.zones.length + 1}`,
          points: [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
        };

        const zones = [...this.state.zones];
        if (this.state.editingZoneIndex !== null) {
          zones[this.state.editingZoneIndex] = zone;
        } else {
          zones.push(zone);
        }

        this.updateState({
          zones,
          dragState: null,
          editingZoneIndex: null,
          zoneName: '',
        });
        break;
      }

      case 'DELETE_ZONE': {
        const zones = this.state.zones.filter((_, i) => i !== action.index);
        this.updateState({ zones });
        break;
      }

      case 'START_EDIT_ZONE': {
        if (action.index < 0 || action.index >= this.state.zones.length) {
          throw new Error(`Invalid zone index: ${action.index}`);
        }
        const zone = this.state.zones[action.index];
        this.updateState({
          editingZoneIndex: action.index,
          zoneName: zone.name,
          tool: 'zone',
        });
        break;
      }

      case 'UPDATE_ZONE_NAME': {
        if (action.index < 0 || action.index >= this.state.zones.length) {
          throw new Error(`Invalid zone index: ${action.index}`);
        }
        const zones = [...this.state.zones];
        zones[action.index] = { ...zones[action.index], name: action.name };
        this.updateState({ zones });
        break;
      }

      case 'SET_ZONE_NAME':
        this.updateState({ zoneName: action.name });
        break;

      case 'SELECT_ASSET':
        this.updateState({
          pendingAsset: {
            key: action.asset.key,
            dataUrl: action.asset.dataUrl,
            packUuid: action.asset.packUuid,
            itemId: action.asset.itemId,
            category: action.asset.category,
            collide: action.asset.collide,
            width: action.asset.width,
            height: action.asset.height,
            rotation: 0,
            rotationAllowed: action.asset.rotationAllowed,
            scaleFactor: action.asset.scaleFactor,
          },
          tool: 'asset',
        });
        break;

      case 'PLACE_ASSET': {
        if (!this.state.pendingAsset) {
          throw new Error('Cannot place asset: no asset selected');
        }

        const tileSize = 16;
        const x = action.tileX * tileSize + tileSize / 2;
        const y = action.tileY * tileSize + tileSize / 2;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const asset: Asset = {
          id,
          key: this.state.pendingAsset.key,
          dataUrl: this.state.pendingAsset.dataUrl,
          x,
          y,
          packUuid: this.state.pendingAsset.packUuid,
          itemId: this.state.pendingAsset.itemId,
          category: this.state.pendingAsset.category,
          collide: this.state.pendingAsset.collide,
          width: this.state.pendingAsset.width,
          height: this.state.pendingAsset.height,
          rotation: this.state.pendingAsset.rotation,
          scaleFactor: this.state.pendingAsset.scaleFactor,
        };

        this.updateState({
          assets: [...this.state.assets, asset],
        });
        break;
      }

      case 'START_ASSET_DRAG':
        this.updateState({
          dragState: {
            startTileX: action.tileX,
            startTileY: action.tileY,
            endTileX: action.tileX,
            endTileY: action.tileY,
          },
        });
        break;

      case 'UPDATE_ASSET_DRAG':
        if (!this.state.dragState) {
          throw new Error('Cannot update drag: no drag in progress');
        }
        this.updateState({
          dragState: {
            ...this.state.dragState,
            endTileX: action.tileX,
            endTileY: action.tileY,
          },
        });
        break;

      case 'COMPLETE_ASSET_DRAG': {
        if (!this.state.dragState || !this.state.pendingAsset) {
          throw new Error('Cannot complete asset drag: invalid state');
        }

        const { startTileX, startTileY } = this.state.dragState;
        const minX = Math.min(startTileX, action.tileX);
        const minY = Math.min(startTileY, action.tileY);
        const maxX = Math.max(startTileX, action.tileX);
        const maxY = Math.max(startTileY, action.tileY);

        const tileSize = 16;
        const newAssets: Asset[] = [];

        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            const x = tx * tileSize + tileSize / 2;
            const y = ty * tileSize + tileSize / 2;
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            newAssets.push({
              id,
              key: this.state.pendingAsset.key,
              dataUrl: this.state.pendingAsset.dataUrl,
              x,
              y,
              packUuid: this.state.pendingAsset.packUuid,
              itemId: this.state.pendingAsset.itemId,
              category: this.state.pendingAsset.category,
              collide: this.state.pendingAsset.collide,
              width: this.state.pendingAsset.width,
              height: this.state.pendingAsset.height,
              rotation: this.state.pendingAsset.rotation,
              scaleFactor: this.state.pendingAsset.scaleFactor,
            });
          }
        }

        this.updateState({
          assets: [...this.state.assets, ...newAssets],
          dragState: null,
        });
        break;
      }

      case 'DELETE_ASSET': {
        const assets = this.state.assets.filter(a => a.id !== action.id);
        this.updateState({ assets });
        break;
      }

      case 'ADD_PACK_ITEMS': {
        const existingKeys = new Set(
          this.state.packItems.map(item => `${item.packUuid}:${item.itemId}`)
        );
        const newItems = action.items.filter(
          item => !existingKeys.has(`${item.packUuid}:${item.itemId}`)
        );
        this.updateState({
          packItems: [...this.state.packItems, ...newItems],
        });
        break;
      }

      case 'REGISTER_TILESET': {
        const tilesets = [...this.state.tilesets];
        const idx = tilesets.findIndex(t => t.key === action.tileset.key);
        if (idx >= 0) {
          tilesets[idx] = action.tileset;
        } else {
          tilesets.push(action.tileset);
        }
        this.updateState({ tilesets });
        break;
      }

      case 'LOAD_TILESETS':
        this.updateState({ tilesets: action.tilesets });
        break;

      case 'SET_SPAWN': {
        logger.debug('[EditorService] SET_SPAWN', action);
        this.updateState({ spawn: { x: action.x, y: action.y } });
        break;
      }

      case 'CLEAR_SPAWN':
        this.updateState({ spawn: null });
        break;

      case 'SET_TERRAIN_COLOR':
        this.updateState({ terrainColor: action.color });
        break;

      case 'TOGGLE_GRID':
        this.updateState({ gridVisible: !this.state.gridVisible });
        break;

      case 'SET_BACKGROUND_COLOR':
        this.updateState({ backgroundColor: action.color });
        break;

      case 'LOAD_STATE':
        this.updateState(action.state);
        break;

      case 'CLEAR_DRAG':
        this.updateState({ dragState: null });
        break;

      case 'UPDATE_ZONE_TYPE': {
        if (action.index < 0 || action.index >= this.state.zones.length) {
          throw new Error(`Invalid zone index: ${action.index}`);
        }
        const zones = [...this.state.zones];
        if (action.zoneType === 'default') {
          // Clear portal fields when switching to default
          const { portalTarget: _pt, portalSpawnX: _px, portalSpawnY: _py, ...rest } = zones[action.index];
          zones[action.index] = { ...rest, type: 'default' };
        } else {
          zones[action.index] = { ...zones[action.index], type: action.zoneType };
        }
        this.updateState({ zones });
        break;
      }

      case 'UPDATE_ZONE_PORTAL': {
        if (action.index < 0 || action.index >= this.state.zones.length) {
          throw new Error(`Invalid zone index: ${action.index}`);
        }
        const zones = [...this.state.zones];
        const updated = { ...zones[action.index] };
        if ('portalTarget' in action) updated.portalTarget = action.portalTarget;
        if ('portalSpawnX' in action) updated.portalSpawnX = action.portalSpawnX;
        if ('portalSpawnY' in action) updated.portalSpawnY = action.portalSpawnY;
        zones[action.index] = updated;
        this.updateState({ zones });
        break;
      }

      case 'ROTATE_PENDING_ASSET': {
        if (!this.state.pendingAsset || !this.state.pendingAsset.rotationAllowed) break;
        const currentRotation = this.state.pendingAsset.rotation ?? 0;
        const nextRotation = (currentRotation + 90) % 360;
        this.updateState({
          pendingAsset: { ...this.state.pendingAsset, rotation: nextRotation },
        });
        break;
      }

      case 'SELECT_WALL_TYPE':
        this.updateState({
          selectedWallTypeId: action.wallTypeId,
          tool: 'wall',
          category: 'autotiles',
        });
        break;

      case 'SELECT_TILE_REF':
        this.updateState({
          selectedTileRefId: action.tileRefId,
          selectedTilesetSlot: action.slot,
          tool: 'terrain',
        });
        break;

      case 'SELECT_MAP_OBJECT':
        this.updateState({ selectedObjectId: action.objectId });
        break;

      case 'UPDATE_MAP_OBJECT': {
        const objects = this.state.mapObjects.map(o =>
          (String(o.id) === String(action.objectId)) ? { ...o, ...action.updates } : o
        );
        this.updateState({ mapObjects: objects });
        break;
      }

      case 'ADD_PENDING_TERRAIN_PAINT':
        this.updateState({
          pendingChanges: {
            ...this.state.pendingChanges,
            terrainPaints: [...this.state.pendingChanges.terrainPaints, action.paint],
          },
        });
        break;

      case 'ADD_PENDING_OBJECT_CREATE':
        this.updateState({
          mapObjects: [...this.state.mapObjects, action.object],
          pendingChanges: {
            ...this.state.pendingChanges,
            objectsToAdd: [...this.state.pendingChanges.objectsToAdd, action.object],
          },
        });
        break;

      case 'ADD_PENDING_OBJECT_DELETE': {
        const objToDelete = this.state.mapObjects.find(o => String(o.id) === String(action.objectId));
        const updatedMapObjects = this.state.mapObjects.filter(o => String(o.id) !== String(action.objectId));
        let updatedPending = { ...this.state.pendingChanges };
        if (objToDelete?._pending === 'add') {
          // Never reached server, remove from pending adds
          updatedPending = {
            ...updatedPending,
            objectsToAdd: updatedPending.objectsToAdd.filter(o => String(o.id) !== String(action.objectId)),
          };
        } else {
          updatedPending = {
            ...updatedPending,
            objectsToDelete: [...updatedPending.objectsToDelete, action.objectId],
          };
        }
        // Also remove any pending updates for this object
        updatedPending = {
          ...updatedPending,
          objectUpdates: updatedPending.objectUpdates.filter(u => String(u.id) !== String(action.objectId)),
        };
        this.updateState({ mapObjects: updatedMapObjects, pendingChanges: updatedPending });
        break;
      }

      case 'ADD_PENDING_OBJECT_UPDATE': {
        const existing = this.state.pendingChanges.objectUpdates.find(u => String(u.id) === String(action.objectId));
        let objectUpdates: Array<{ id: number | string; updates: Partial<MapObjectRecord> }>;
        if (existing) {
          objectUpdates = this.state.pendingChanges.objectUpdates.map(u =>
            String(u.id) === String(action.objectId) ? { ...u, updates: { ...u.updates, ...action.updates } } : u
          );
        } else {
          objectUpdates = [...this.state.pendingChanges.objectUpdates, { id: action.objectId, updates: action.updates }];
        }
        // Also update local mapObjects for immediate visual feedback
        const updatedObjects = this.state.mapObjects.map(o =>
          (String(o.id) === String(action.objectId)) ? { ...o, ...action.updates } : o
        );
        this.updateState({
          mapObjects: updatedObjects,
          pendingChanges: { ...this.state.pendingChanges, objectUpdates },
        });
        break;
      }

      case 'MARK_ZONES_MODIFIED':
        this.updateState({
          pendingChanges: { ...this.state.pendingChanges, zonesModified: true },
        });
        break;

      case 'SET_PENDING_SPAWN':
        this.updateState({
          spawn: { x: action.x, y: action.y },
          pendingChanges: { ...this.state.pendingChanges, spawnUpdate: { x: action.x, y: action.y } },
        });
        break;

      case 'CLEAR_PENDING_CHANGES':
        this.updateState({
          pendingChanges: { terrainPaints: [], objectsToAdd: [], objectsToDelete: [], objectUpdates: [], zonesModified: false, spawnUpdate: null },
        });
        break;

      case 'LOAD_MAP_OBJECTS':
        this.updateState({ mapObjects: action.objects });
        break;

      case 'TOGGLE_VIEW':
        this.updateState({
          viewToggles: { ...this.state.viewToggles, [action.key]: !this.state.viewToggles[action.key] },
        });
        break;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = action;
        throw new Error(`Unknown action type: ${(_exhaustive as any).type}`);
    }
  }

  public hasPendingChanges(): boolean {
    const p = this.state.pendingChanges;
    return p.terrainPaints.length > 0 ||
      p.objectsToAdd.length > 0 ||
      p.objectsToDelete.length > 0 ||
      p.objectUpdates.length > 0 ||
      p.zonesModified ||
      p.spawnUpdate !== null;
  }

  public getPendingChangesCount(): number {
    const p = this.state.pendingChanges;
    return p.terrainPaints.length +
      p.objectsToAdd.length +
      p.objectsToDelete.length +
      p.objectUpdates.length +
      (p.zonesModified ? 1 : 0) +
      (p.spawnUpdate ? 1 : 0);
  }

  public reset(): void {
    this.state = this.createInitialState();
    this.notify();
  }
}

export const EditorService = new EditorServiceClass();

// Expose auf window für Debugging
if (typeof window !== 'undefined' && ((import.meta as any).env?.DEV || (import.meta as any).env?.VITE_DEBUG_LOGS === 'true')) {
  (window as any).EditorService = EditorService;
}
