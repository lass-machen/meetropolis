import { EditorService } from './EditorService';
import type { EditorState } from './EditorTypes';

// Module-wide, monotonically decreasing negative counter for temporary MapObject IDs.
// Each newly created pending instance gets the next value, one smaller than
// value, starting at -1. Assignment is therefore independent of the clock and
// tile coordinates, so that even densely consecutive stamps and drags
// never collide. The counter lives at module level (client session lifetime) and
// is deliberately not reset by EditorService.reset.
let nextPendingObjectId = -1;

// Assigns the next temporary negative ID. Not exported: only the two
// production helpers in this file may create IDs.
function allocatePendingObjectId(): number {
  const id = nextPendingObjectId;
  nextPendingObjectId -= 1;
  return id;
}

/**
 * stampPendingAsset: stamps an object/structure asset onto a tile.
 *
 * Runs the logic extracted from EditorInputHandler.handleAssetTool
 * stamp branch: dispatch PLACE_ASSET, and address the asset newly
 * address the created asset and a pending create with all previous
 * fields (including clientAssetId) queued. Dispatch,
 * Append reference and pending create are unchanged from the handler.
 */
export function stampPendingAsset(
  tileX: number,
  tileY: number,
  pendingAsset: NonNullable<EditorState['pendingAsset']>,
): void {
  // Record the asset count before stamping, so that afterwards exactly the asset newly created at this
  // Append-Index neu erzeugte Asset zu adressieren.
  const assetCountBefore = EditorService.getState().assets.length;
  EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });
  const placedAsset = EditorService.getState().assets[assetCountBefore];

  // Queue every stamped tile for DB persistence.
  EditorService.dispatch({
    type: 'ADD_PENDING_OBJECT_CREATE',
    object: {
      id: allocatePendingObjectId(),
      assetPackUuid: pendingAsset.packUuid || '',
      itemId: pendingAsset.itemId || '',
      category: pendingAsset.category || 'objects',
      tileX,
      tileY,
      width: pendingAsset.width || 16,
      height: pendingAsset.height || 16,
      collide: pendingAsset.collide || false,
      zIndex: 0,
      scaleFactor: pendingAsset.scaleFactor || 1,
      rotation: pendingAsset.rotation || 0,
      dataUrl: pendingAsset.dataUrl,
      // Depth layering: take over the manifest default value of the asset type
      // adopt, so that editor-placed objects match the generated template.
      collisionBaseHeight: pendingAsset.collisionBaseHeight ?? 0,
      renderLayer: pendingAsset.renderLayer ?? 'sorted',
      _pending: 'add',
      // Purely client-side instance reference to the just-stamped asset.
      clientAssetId: placedAsset.id,
    },
  });
}

/**
 * completePendingTerrainDrag: finishes a terrain drag.
 *
 * Runs the logic extracted from EditorInputHandler.handleAssetTool
 * terrain branch phase up: dispatch COMPLETE_ASSET_DRAG, then the
 * capture the appended asset range and queue one
 * pending create with all existing fields (including
 * clientAssetId) queued. Uses the real EditorService and is free
 * of Phaser dependencies. Algorithm, metadata, temp IDs and
 * append order are unchanged from the handler.
 */
export function completePendingTerrainDrag(
  tileX: number,
  tileY: number,
  pendingAsset: NonNullable<EditorState['pendingAsset']>,
  dragState: NonNullable<EditorState['dragState']>,
): void {
  // record the asset count before the drag append; the area appended afterwards
  // is already in rectangle order (minY/maxY first, then minX/maxX).
  const assetCountBefore = EditorService.getState().assets.length;
  EditorService.dispatch({ type: 'COMPLETE_ASSET_DRAG', tileX, tileY });
  const appendedAssets = EditorService.getState().assets.slice(assetCountBefore);

  // Queue every tile in the drag rectangle for DB persistence.
  const minX = Math.min(dragState.startTileX, tileX);
  const minY = Math.min(dragState.startTileY, tileY);
  const maxX = Math.max(dragState.startTileX, tileX);
  const maxY = Math.max(dragState.startTileY, tileY);

  let placedIndex = 0;
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const dragAsset = appendedAssets[placedIndex];
      placedIndex++;
      EditorService.dispatch({
        type: 'ADD_PENDING_OBJECT_CREATE',
        object: {
          id: allocatePendingObjectId(),
          assetPackUuid: pendingAsset.packUuid || '',
          itemId: pendingAsset.itemId || '',
          category: pendingAsset.category || 'terrain',
          tileX: tx,
          tileY: ty,
          width: pendingAsset.width || 16,
          height: pendingAsset.height || 16,
          collide: pendingAsset.collide || false,
          zIndex: 0,
          scaleFactor: pendingAsset.scaleFactor || 1,
          rotation: pendingAsset.rotation || 0,
          dataUrl: pendingAsset.dataUrl,
          // Terrain objects render on the floor, always below actors.
          collisionBaseHeight: pendingAsset.collisionBaseHeight ?? 0,
          renderLayer: 'floor',
          _pending: 'add',
          // Address the associated drag asset in rectangle order.
          clientAssetId: dragAsset.id,
        },
      });
    }
  }
}
