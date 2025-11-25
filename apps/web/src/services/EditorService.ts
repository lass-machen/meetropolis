/**
 * EditorService - Single Source of Truth für den Map-Editor
 * 
 * Architektur-Prinzipien:
 * - Immutable State Pattern
 * - Explizite Actions für alle Operationen
 * - Keine Error-Swallowing
 * - Observer Pattern für State-Updates
 */

export type EditorTool = 'zone' | 'asset' | 'terrain' | 'collision' | 'spawn' | 'select' | 'erase';
export type EditorCategory = 'general' | 'terrain' | 'structures' | 'objects' | 'zones' | 'collisions';

export type Zone = {
  name: string;
  points: { x: number; y: number }[];
};

export type Asset = {
  id: string;
  key: string;
  dataUrl: string;
  x: number;
  y: number;
  packUuid?: string;
  itemId?: string;
  category?: 'structures' | 'objects' | 'terrain';
  collide?: boolean;
  width?: number;
  height?: number;
};

export type PackItem = {
  packUuid: string;
  itemId: string;
  key: string;
  category: 'terrain' | 'structures' | 'objects';
  dataUrl: string;
  width: number;
  height: number;
  collide: boolean;
};

export type Tileset = {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  category?: string;
};

export type EditorState = {
  active: boolean;
  tool: EditorTool;
  category: EditorCategory;
  selectedAsset?: Asset;
  terrainColor?: string;
  gridVisible: boolean;

  // Zone-Daten
  zones: Zone[];
  editingZoneIndex: number | null;
  zoneName: string;

  // Asset-Daten
  assets: Asset[];
  pendingAsset: {
    key: string;
    dataUrl: string;
    packUuid?: string;
    itemId?: string;
    category?: 'structures' | 'objects' | 'terrain';
    collide?: boolean;
    width?: number;
    height?: number;
  } | null;
  packItems: PackItem[];

  // Terrain-Daten
  tilesets: Tileset[];

  // Spawn-Daten
  spawn: { x: number; y: number } | null;

  // UI-State
  backgroundColor: string;

  // Drag-State (für Tools)
  dragState: {
    startTileX: number;
    startTileY: number;
    endTileX: number;
    endTileY: number;
  } | null;
};

// Actions
export type EditorAction =
  | { type: 'ACTIVATE_EDITOR'; category?: EditorCategory }
  | { type: 'DEACTIVATE_EDITOR' }
  | { type: 'SET_TOOL'; tool: EditorTool }
  | { type: 'SET_CATEGORY'; category: EditorCategory }

  // Zone Actions
  | { type: 'START_ZONE_DRAG'; tileX: number; tileY: number }
  | { type: 'UPDATE_ZONE_DRAG'; tileX: number; tileY: number }
  | { type: 'COMPLETE_ZONE'; tileX: number; tileY: number; name?: string }
  | { type: 'DELETE_ZONE'; index: number }
  | { type: 'START_EDIT_ZONE'; index: number }
  | { type: 'UPDATE_ZONE_NAME'; index: number; name: string }
  | { type: 'SET_ZONE_NAME'; name: string }

  // Asset Actions
  | { type: 'SELECT_ASSET'; asset: PackItem }
  | { type: 'PLACE_ASSET'; tileX: number; tileY: number }
  | { type: 'START_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'UPDATE_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'COMPLETE_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'DELETE_ASSET'; id: string }
  | { type: 'ADD_PACK_ITEMS'; items: PackItem[] }

  // Tileset Actions
  | { type: 'REGISTER_TILESET'; tileset: Tileset }
  | { type: 'LOAD_TILESETS'; tilesets: Tileset[] }

  // Spawn Actions
  | { type: 'SET_SPAWN'; x: number; y: number }
  | { type: 'CLEAR_SPAWN' }

  // State Actions
  | { type: 'SET_BACKGROUND_COLOR'; color: string }
  | { type: 'SET_TERRAIN_COLOR'; color: string }
  | { type: 'TOGGLE_GRID' }
  | { type: 'LOAD_STATE'; state: Partial<EditorState> }
  | { type: 'CLEAR_DRAG' };

export type EditorListener = (state: EditorState) => void;

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
      zonesVisible: true,
      assets: [],
      pendingAsset: null,
      packItems: [],
      tilesets: [],
      spawn: undefined,
      backgroundColor: undefined,
      terrainColor: undefined,
      gridVisible: false,
      dragState: null,
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
        });
        break;

      case 'SET_TOOL':
        this.updateState({ tool: action.tool, dragState: null });
        break;

      case 'SET_CATEGORY':
        this.updateState({
          category: action.category,
          tool: action.category === 'zones' ? 'zone' : 'select',
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
        console.log('[EditorService] SET_SPAWN', action);
        this.updateState({ spawn: { x: action.x, y: action.y } });
        break;
      }

      case 'CLEAR_SPAWN':
        this.updateState({ spawn: undefined });
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

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = action;
        throw new Error(`Unknown action type: ${(_exhaustive as any).type}`);
    }
  }

  public reset(): void {
    this.state = this.createInitialState();
    this.notify();
  }
}

export const EditorService = new EditorServiceClass();

// Expose auf window für Debugging
if (typeof window !== 'undefined') {
  (window as any).EditorService = EditorService;
}
