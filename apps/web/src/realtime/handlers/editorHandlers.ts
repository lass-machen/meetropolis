import { EditorService } from '../../services/EditorService';
import type { Zone } from '../../services/EditorTypes';
import { useMapStore } from '../../state/mapStore';
import type { UseWorldRoomArgs } from '../types';
import type {
  ChunksUpdatedMessage,
  EditorUpdateMessage,
  ObjectsUpdatedMessage,
  TilesetRegistryUpdatedMessage,
  WorldRoom,
} from '../../types/colyseus';
import type { ChunkUpdateEntry, EditorUpdatePayload, ObjectsUpdatedPayload, TilePaintEdit } from '../../types/game';
import type { EditorState } from '../../services/EditorService';

export function setupEditorHandlers(
  room: WorldRoom,
  args: UseWorldRoomArgs,
  scheduleBuildParticipantList: (delay: number) => void,
) {
  const { gameBridge, zoneRef, setEditor } = args;

  /** Returns true if this update is for a different map (should be skipped). */
  const isWrongMap = (payload: { mapId?: string } | null | undefined): boolean => {
    const payloadMapId = payload?.mapId;
    if (!payloadMapId) return false; // no mapId in payload → can't filter, allow through
    const currentMapId = useMapStore.getState().currentMapId;
    return currentMapId !== '' && payloadMapId !== currentMapId;
  };

  room.onMessage('editor_update', (data: EditorUpdateMessage) => {
    if (isWrongMap(data)) return;
    if (data?.type === 'zone' && Array.isArray(data.polys)) {
      // Server delivers zone polys as opaque unknown[]; cast to Zone[] for
      // EditorService consumption (shape mirrored from EditorTypes.Zone).
      const polys = data.polys as Zone[];
      // WICHTIG: EditorService als Single Source of Truth updaten!
      EditorService.dispatch({ type: 'LOAD_STATE', state: { zones: polys } });
      // useState wird durch EditorService-Subscription automatisch aktualisiert
      if (gameBridge && typeof gameBridge.setZoneOverlay === 'function') gameBridge.setZoneOverlay(polys);
      if (zoneRef.current && typeof zoneRef.current.setZones === 'function') zoneRef.current.setZones(polys);
      scheduleBuildParticipantList(0);
      return;
    }
    if (data?.type === 'spawn' && data.pos && typeof data.pos.x === 'number' && typeof data.pos.y === 'number') {
      const pos = data.pos;
      try {
        gameBridge?.setSpawnMarker?.({ x: pos.x, y: pos.y });
      } catch {}
      try {
        setEditor((s: EditorState) => ({ ...s, spawn: { x: pos.x, y: pos.y } }));
      } catch {}
      return;
    }
    if (data?.type === 'tile_paint' && data.edit) {
      // Server-side editor handler validates the edit shape; cast at the
      // network boundary so the bridge receives the typed payload.
      if (gameBridge && typeof gameBridge.applyTilePaint === 'function')
        gameBridge.applyTilePaint(data.edit as TilePaintEdit);
      return;
    }
    if (data?.type === 'layers' || data?.type === 'all') {
      if (gameBridge && typeof gameBridge.fetchAndApplyServerLayers === 'function')
        gameBridge.fetchAndApplyServerLayers();
      return;
    }
    if (gameBridge && typeof gameBridge.handleEditorUpdate === 'function')
      gameBridge.handleEditorUpdate(data as EditorUpdatePayload);
  });

  // v2: Chunks-Updates direkt anwenden
  room.onMessage('chunks_updated', (payload: ChunksUpdatedMessage) => {
    try {
      if (isWrongMap(payload)) return;
      const layer = payload && typeof payload.layer === 'string' ? payload.layer : null;
      const updates = Array.isArray(payload?.updates) ? payload.updates : [];
      if (!layer || updates.length === 0) return;
      const layerName =
        layer === 'collision' || layer === 'walls' || layer === 'ground' || layer === 'walls_auto' ? layer : null;
      if (!layerName) return;
      if (gameBridge && typeof gameBridge.applyChunkUpdates === 'function') {
        // Server side guarantees each update entry has key/version/encoding/data;
        // cast at the network boundary.
        gameBridge.applyChunkUpdates(layerName, updates as ChunkUpdateEntry[]);
      }
    } catch {}
  });

  // MapObject live updates
  room.onMessage('objects_updated', (payload: ObjectsUpdatedMessage) => {
    try {
      if (isWrongMap(payload)) return;
      if (gameBridge && typeof gameBridge.handleObjectsUpdated === 'function') {
        // ObjectsUpdatedMessage is the loose network shape; the server attaches
        // an `action` discriminator before broadcast.
        gameBridge.handleObjectsUpdated(payload as unknown as ObjectsUpdatedPayload);
      }
    } catch {
      /* ignore */
    }
  });

  // Tileset Registry Sync (v2)
  room.onMessage('tileset_registry_updated', (payload: TilesetRegistryUpdatedMessage) => {
    try {
      if (isWrongMap(payload)) return;
      const registry = Array.isArray(payload?.tilesetRegistry) ? payload.tilesetRegistry : null;
      if (registry && gameBridge && typeof gameBridge.updateTilesetRegistry === 'function') {
        gameBridge.updateTilesetRegistry(registry);
      }
    } catch {}
  });
}
