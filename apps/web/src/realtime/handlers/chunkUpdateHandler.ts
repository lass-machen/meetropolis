import type { UseWorldRoomArgs } from '../types';
import type { ChunksUpdatedMessage } from '../../types/colyseus';
import type { AutotileRegistration, ChunkLayerName, ChunkUpdateEntry } from '../../types/game';

function chunkLayerName(layer: unknown): ChunkLayerName | null {
  return layer === 'collision' || layer === 'walls' || layer === 'ground' || layer === 'walls_auto' ? layer : null;
}

export function applyChunksUpdated(gameBridge: UseWorldRoomArgs['gameBridge'], payload: ChunksUpdatedMessage): void {
  const paletteEntries = Array.isArray(payload?.autotilePaletteEntries)
    ? (payload.autotilePaletteEntries as AutotileRegistration[])
    : [];
  if (paletteEntries.length > 0) gameBridge.registerAutotiles(paletteEntries);

  const layer = chunkLayerName(payload?.layer);
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  if (!layer || updates.length === 0) return;
  gameBridge.applyChunkUpdates?.(layer, updates as ChunkUpdateEntry[]);
}
