import type { EditorState, EditorAction, Asset } from '../EditorTypes';

const TILE_SIZE = 16;

export type AssetActions =
  | Extract<EditorAction, { type: 'SELECT_ASSET' }>
  | Extract<EditorAction, { type: 'PLACE_ASSET' }>
  | Extract<EditorAction, { type: 'START_ASSET_DRAG' }>
  | Extract<EditorAction, { type: 'UPDATE_ASSET_DRAG' }>
  | Extract<EditorAction, { type: 'COMPLETE_ASSET_DRAG' }>
  | Extract<EditorAction, { type: 'DELETE_ASSET' }>
  | Extract<EditorAction, { type: 'ADD_PACK_ITEMS' }>
  | Extract<EditorAction, { type: 'REGISTER_TILESET' }>
  | Extract<EditorAction, { type: 'LOAD_TILESETS' }>
  | Extract<EditorAction, { type: 'ROTATE_PENDING_ASSET' }>
  | Extract<EditorAction, { type: 'SELECT_WALL_TYPE' }>
  | Extract<EditorAction, { type: 'SET_AUTOTILE_ITEMS' }>
  | Extract<EditorAction, { type: 'SELECT_TILE_REF' }>;

function buildAssetFromPending(pending: NonNullable<EditorState['pendingAsset']>, x: number, y: number): Asset {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id, key: pending.key, dataUrl: pending.dataUrl, x, y,
    packUuid: pending.packUuid, itemId: pending.itemId, category: pending.category,
    collide: pending.collide, width: pending.width, height: pending.height,
    rotation: pending.rotation, scaleFactor: pending.scaleFactor,
  };
}

function dragRectAssets(state: EditorState, action: Extract<EditorAction, { type: 'COMPLETE_ASSET_DRAG' }>): Asset[] {
  const { startTileX, startTileY } = state.dragState!;
  const minX = Math.min(startTileX, action.tileX);
  const minY = Math.min(startTileY, action.tileY);
  const maxX = Math.max(startTileX, action.tileX);
  const maxY = Math.max(startTileY, action.tileY);
  const newAssets: Asset[] = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      newAssets.push(buildAssetFromPending(state.pendingAsset!, tx * TILE_SIZE, ty * TILE_SIZE));
    }
  }
  return newAssets;
}

export function reduceAsset(state: EditorState, action: AssetActions): Partial<EditorState> | null {
  switch (action.type) {
    case 'SELECT_ASSET':
      return {
        pendingAsset: {
          key: action.asset.key, dataUrl: action.asset.dataUrl, packUuid: action.asset.packUuid,
          itemId: action.asset.itemId, category: action.asset.category, collide: action.asset.collide,
          width: action.asset.width, height: action.asset.height, rotation: 0,
          rotationAllowed: action.asset.rotationAllowed, scaleFactor: action.asset.scaleFactor,
        },
        tool: 'asset',
      };
    case 'PLACE_ASSET': {
      if (!state.pendingAsset) throw new Error('Cannot place asset: no asset selected');
      const asset = buildAssetFromPending(state.pendingAsset, action.tileX * TILE_SIZE, action.tileY * TILE_SIZE);
      return { assets: [...state.assets, asset] };
    }
    case 'START_ASSET_DRAG':
      return { dragState: { startTileX: action.tileX, startTileY: action.tileY, endTileX: action.tileX, endTileY: action.tileY } };
    case 'UPDATE_ASSET_DRAG':
      if (!state.dragState) throw new Error('Cannot update drag: no drag in progress');
      return { dragState: { ...state.dragState, endTileX: action.tileX, endTileY: action.tileY } };
    case 'COMPLETE_ASSET_DRAG': {
      if (!state.dragState || !state.pendingAsset) throw new Error('Cannot complete asset drag: invalid state');
      return { assets: [...state.assets, ...dragRectAssets(state, action)], dragState: null };
    }
    case 'DELETE_ASSET':
      return { assets: state.assets.filter(a => a.id !== action.id) };
    case 'ADD_PACK_ITEMS': {
      const existingKeys = new Set(state.packItems.map(item => `${item.packUuid}:${item.itemId}`));
      const newItems = action.items.filter(item => !existingKeys.has(`${item.packUuid}:${item.itemId}`));
      return { packItems: [...state.packItems, ...newItems] };
    }
    case 'REGISTER_TILESET': {
      const tilesets = [...state.tilesets];
      const idx = tilesets.findIndex(t => t.key === action.tileset.key);
      if (idx >= 0) tilesets[idx] = action.tileset;
      else tilesets.push(action.tileset);
      return { tilesets };
    }
    case 'LOAD_TILESETS':
      return { tilesets: action.tilesets };
    case 'ROTATE_PENDING_ASSET': {
      if (!state.pendingAsset || !state.pendingAsset.rotationAllowed) return {};
      const currentRotation = state.pendingAsset.rotation ?? 0;
      const nextRotation = (currentRotation + 90) % 360;
      return { pendingAsset: { ...state.pendingAsset, rotation: nextRotation } };
    }
    case 'SELECT_WALL_TYPE':
      return { selectedWallTypeId: action.wallTypeId, tool: 'wall', category: 'autotiles' };
    case 'SET_AUTOTILE_ITEMS':
      return { autotileItems: action.items };
    case 'SELECT_TILE_REF':
      return { selectedTileRefId: action.tileRefId, selectedTilesetSlot: action.slot, tool: 'terrain' };
  }
  return null;
}
