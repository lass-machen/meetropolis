import { EditorService } from '../../services/EditorService';
import type { UseWorldRoomArgs } from '../types';

export function setupEditorHandlers(
  room: any,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void
) {
  const { gameBridge, zoneRef, setEditor } = args;

  room.onMessage('editor_update', (data: any) => {
    if (data?.type === 'zone' && Array.isArray(data.polys)) {
      // WICHTIG: EditorService als Single Source of Truth updaten!
      EditorService.dispatch({ type: 'LOAD_STATE', state: { zones: data.polys } });
      // useState wird durch EditorService-Subscription automatisch aktualisiert
      try { localStorage.setItem('meetropolis.zones', JSON.stringify(data.polys)); } catch {}
      if (gameBridge && typeof gameBridge.setZoneOverlay === 'function') gameBridge.setZoneOverlay(data.polys);
      if (zoneRef.current && typeof zoneRef.current.setZones === 'function') zoneRef.current.setZones(data.polys);
      scheduleBuildParticipantList(0);
      return;
    }
    if (data?.type === 'spawn' && data.pos && typeof data.pos.x === 'number' && typeof data.pos.y === 'number') {
      try { gameBridge?.setSpawnMarker?.({ x: data.pos.x, y: data.pos.y }); } catch {}
      try { localStorage.setItem('meetropolis.spawn', JSON.stringify({ x: data.pos.x, y: data.pos.y })); } catch {}
      try { setEditor((s: any) => ({ ...s, spawn: { x: data.pos.x, y: data.pos.y } })); } catch {}
      return;
    }
    if (data?.type === 'tile_paint' && data.edit) {
      if (gameBridge && typeof gameBridge.applyTilePaint === 'function') gameBridge.applyTilePaint(data.edit);
      return;
    }
    if (data?.type === 'layers' || data?.type === 'all') {
      if (gameBridge && typeof (gameBridge as any).fetchAndApplyServerLayers === 'function') (gameBridge as any).fetchAndApplyServerLayers();
      return;
    }
    if (data?.type === 'asset' && Array.isArray(data.assets)) {
      if (gameBridge && typeof (gameBridge as any).setEditorAssets === 'function') (gameBridge as any).setEditorAssets(data.assets);
      return;
    }
    if (gameBridge && typeof (gameBridge as any).handleEditorUpdate === 'function') (gameBridge as any).handleEditorUpdate(data);
  });

  // v2: Chunks-Updates direkt anwenden
  room.onMessage('chunks_updated', (payload: any) => {
    try {
      const layer = (payload && typeof payload.layer === 'string') ? payload.layer : null;
      const updates = Array.isArray(payload?.updates) ? payload.updates : [];
      if (!layer || updates.length === 0) return;
      const layerName = (layer === 'collision' || layer === 'walls' || layer === 'ground') ? layer : null;
      if (!layerName) return;
      if (gameBridge && typeof (gameBridge as any).applyChunkUpdates === 'function') {
        (gameBridge as any).applyChunkUpdates(layerName, updates);
      }
    } catch {}
  });

  // Tileset Registry Sync (v2)
  room.onMessage('tileset_registry_updated', (payload: any) => {
    try {
      const registry = Array.isArray(payload?.tilesetRegistry) ? payload.tilesetRegistry : null;
      if (registry && gameBridge && typeof (gameBridge as any).updateTilesetRegistry === 'function') {
        (gameBridge as any).updateTilesetRegistry(registry);
      }
    } catch {}
  });
}
