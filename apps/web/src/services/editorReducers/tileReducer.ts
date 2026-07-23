import type { EditorState, EditorAction } from '../EditorTypes';

export type TileActions =
  | Extract<EditorAction, { type: 'START_TILE_DRAG' }>
  | Extract<EditorAction, { type: 'UPDATE_TILE_DRAG' }>
  | Extract<EditorAction, { type: 'COMPLETE_TILE_DRAG' }>;

export type CompleteTileFollowups = Array<EditorAction>;

/**
 * START_TILE_DRAG / UPDATE_TILE_DRAG: pure dragState updates.
 * COMPLETE_TILE_DRAG returns clearance + a list of follow-up actions to dispatch.
 */
export function reduceTile(
  state: EditorState,
  action: TileActions,
): { update: Partial<EditorState>; followups?: CompleteTileFollowups } {
  switch (action.type) {
    case 'START_TILE_DRAG':
      return {
        update: {
          dragState: {
            startTileX: action.tileX,
            startTileY: action.tileY,
            endTileX: action.tileX,
            endTileY: action.tileY,
            tileDragMode: action.mode,
          },
        },
      };
    case 'UPDATE_TILE_DRAG':
      if (!state.dragState) throw new Error('Cannot update tile drag: no drag in progress');
      return { update: { dragState: { ...state.dragState, endTileX: action.tileX, endTileY: action.tileY } } };
    case 'COMPLETE_TILE_DRAG':
      return computeCompleteTileDrag(state, action);
  }
}

function computeCompleteTileDrag(
  state: EditorState,
  action: Extract<EditorAction, { type: 'COMPLETE_TILE_DRAG' }>,
): { update: Partial<EditorState>; followups: CompleteTileFollowups } {
  if (!state.dragState) throw new Error('Cannot complete tile drag: no drag in progress');
  const { startTileX, startTileY, tileDragMode } = state.dragState;
  const x0 = Math.min(startTileX, action.tileX);
  const y0 = Math.min(startTileY, action.tileY);
  const x1 = Math.max(startTileX, action.tileX);
  const y1 = Math.max(startTileY, action.tileY);
  const rect = { x0, y0, x1, y1 };

  const followups: CompleteTileFollowups = [];
  switch (tileDragMode) {
    case 'terrain':
      followups.push({
        type: 'ADD_PENDING_TERRAIN_PAINT',
        paint: { layer: 'ground', rect, tileRefId: state.selectedTileRefId },
      });
      break;
    case 'wall':
      followups.push({
        type: 'ADD_PENDING_TERRAIN_PAINT',
        paint: { layer: 'walls_auto', rect, tileRefId: state.selectedWallTypeId },
      });
      break;
    case 'collision':
      followups.push({ type: 'ADD_PENDING_TERRAIN_PAINT', paint: { layer: 'collision', rect, tileRefId: 1 } });
      break;
    case 'erase': {
      const cat = state.category;
      if (cat === 'terrain' || cat === 'autotiles') {
        followups.push({ type: 'ADD_PENDING_TERRAIN_PAINT', paint: { layer: 'ground', rect, tileRefId: 0 } });
        followups.push({
          type: 'ADD_PENDING_TERRAIN_PAINT',
          paint: { layer: 'walls', rect, tileRefId: 0, erase: true },
        });
      } else if (cat === 'collisions') {
        followups.push({
          type: 'ADD_PENDING_TERRAIN_PAINT',
          paint: { layer: 'collision', rect, tileRefId: 0, erase: true },
        });
      }
      break;
    }
  }
  return { update: { dragState: null }, followups };
}
