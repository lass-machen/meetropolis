import { EditorService } from './EditorService';
import type { EditorState } from './EditorTypes';

// Modulweit monoton fallender Negativ-Zähler für temporäre MapObject-IDs.
// Jede neu erzeugte Pending-Instanz erhält den nächsten um eins kleineren
// Wert, beginnend bei -1. Die Vergabe ist damit unabhängig von Uhr und
// Kachelkoordinaten, sodass auch dicht aufeinanderfolgende Stempel und Drags
// nie kollidieren. Der Zähler lebt auf Modulebene (Client-Sitzungsdauer) und
// wird bei EditorService.reset bewusst nicht zurückgesetzt.
let nextPendingObjectId = -1;

// Vergibt die nächste temporäre Negativ-ID. Nicht exportiert: nur die beiden
// produktiven Helfer in dieser Datei dürfen IDs erzeugen.
function allocatePendingObjectId(): number {
  const id = nextPendingObjectId;
  nextPendingObjectId -= 1;
  return id;
}

/**
 * stampPendingAsset: stempelt ein Objekt-/Struktur-Asset auf eine Kachel.
 *
 * Führt den aus EditorInputHandler.handleAssetTool herausgezogenen
 * Stempel-Zweig aus: PLACE_ASSET dispatchen, das an diesem Append-Index neu
 * erzeugte Asset adressieren und ein Pending-Create mit sämtlichen bisherigen
 * Feldern (einschließlich clientAssetId) vormerken. Dispatch,
 * Append-Referenz und Pending-Create sind gegenüber dem Handler unverändert.
 */
export function stampPendingAsset(
  tileX: number,
  tileY: number,
  pendingAsset: NonNullable<EditorState['pendingAsset']>,
): void {
  // Assetanzahl vor dem Stempeln merken, um danach exakt das an diesem
  // Append-Index neu erzeugte Asset zu adressieren.
  const assetCountBefore = EditorService.getState().assets.length;
  EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });
  const placedAsset = EditorService.getState().assets[assetCountBefore];

  // Jede gestempelte Kachel für die DB-Persistenz vormerken.
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
      // Depth-Layering (Strang B/C): Manifest-Standardwert des Asset-Typs
      // übernehmen, damit per Editor platzierte Objekte der generierten Vorlage entsprechen.
      collisionBaseHeight: pendingAsset.collisionBaseHeight ?? 0,
      renderLayer: pendingAsset.renderLayer ?? 'sorted',
      _pending: 'add',
      // Rein clientseitige Instanzreferenz auf das eben gestempelte Asset.
      clientAssetId: placedAsset.id,
    },
  });
}

/**
 * completePendingTerrainDrag: schließt einen Terrain-Drag ab.
 *
 * Führt den aus EditorInputHandler.handleAssetTool herausgezogenen
 * Terrain-Zweig phase up aus: COMPLETE_ASSET_DRAG dispatchen, den danach
 * angehängten Asset-Bereich erfassen und je Rechteck-Kachel ein
 * Pending-Create mit sämtlichen bisherigen Feldern (einschließlich
 * clientAssetId) vormerken. Nutzt den echten EditorService und ist frei
 * von Phaser-Abhängigkeiten. Algorithmus, Metadaten, Temp-IDs und
 * Append-Reihenfolge sind gegenüber dem Handler unverändert.
 */
export function completePendingTerrainDrag(
  tileX: number,
  tileY: number,
  pendingAsset: NonNullable<EditorState['pendingAsset']>,
  dragState: NonNullable<EditorState['dragState']>,
): void {
  // Assetanzahl vor dem Drag-Append merken; der danach angehängte Bereich
  // steht bereits in Rechteckreihenfolge (erst minY/maxY, dann minX/maxX).
  const assetCountBefore = EditorService.getState().assets.length;
  EditorService.dispatch({ type: 'COMPLETE_ASSET_DRAG', tileX, tileY });
  const appendedAssets = EditorService.getState().assets.slice(assetCountBefore);

  // Jede Kachel im Drag-Rechteck für die DB-Persistenz vormerken.
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
          // Terrain-Objekte rendern auf dem Boden, immer unter Akteuren (Strang C).
          collisionBaseHeight: pendingAsset.collisionBaseHeight ?? 0,
          renderLayer: 'floor',
          _pending: 'add',
          // Zugehöriges Drag-Asset in Rechteckreihenfolge adressieren.
          clientAssetId: dragAsset.id,
        },
      });
    }
  }
}
