import { useRef, useEffect, useState, useCallback } from 'react';
import { EditorService } from '../../services/EditorService';
import { makeTileRefId, baseUrl } from '../../lib/mapV2';
import type { V2Tileset } from '../../lib/mapV2';

type TerrainTileGridProps = {
  v2Tilesets: V2Tileset[];
  selectedTileRefId: number;
};

type TileEntry = { slot: number; tileIndex: number; dataUrl: string };

function extractTiles(tileset: V2Tileset): Promise<TileEntry[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const url = tileset.imageUrl.startsWith('/')
      ? baseUrl() + tileset.imageUrl
      : tileset.imageUrl;
    img.onload = () => {
      const tw = tileset.tileWidth;
      const th = tileset.tileHeight;
      const margin = tileset.margin ?? 0;
      const spacing = tileset.spacing ?? 0;
      const cols = Math.max(1, Math.floor((img.width - margin * 2 + spacing) / (tw + spacing)));
      const rows = Math.max(1, Math.floor((img.height - margin * 2 + spacing) / (th + spacing)));

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d')!;
      const entries: TileEntry[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = margin + c * (tw + spacing);
          const sy = margin + r * (th + spacing);
          ctx.clearRect(0, 0, tw, th);
          ctx.drawImage(img, sx, sy, tw, th, 0, 0, tw, th);
          entries.push({
            slot: tileset.slot,
            tileIndex: r * cols + c,
            dataUrl: canvas.toDataURL(),
          });
        }
      }
      resolve(entries);
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

export function TerrainTileGrid({ v2Tilesets, selectedTileRefId }: TerrainTileGridProps) {
  const [tiles, setTiles] = useState<TileEntry[]>([]);
  const loadedSlotsRef = useRef<string>('');

  const loadTiles = useCallback(async (tilesets: V2Tileset[]) => {
    const key = tilesets.map(t => `${t.slot}:${t.key}`).join(',');
    if (key === loadedSlotsRef.current) return;
    loadedSlotsRef.current = key;

    const results = await Promise.all(tilesets.map(extractTiles));
    setTiles(results.flat());
  }, []);

  useEffect(() => {
    if (v2Tilesets.length > 0) loadTiles(v2Tilesets);
  }, [v2Tilesets, loadTiles]);

  if (tiles.length === 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
        gap: 4,
        maxHeight: 260,
        overflow: 'auto',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--glass)',
        padding: 8,
      }}
    >
      {tiles.map((tile) => {
        const refId = makeTileRefId(tile.slot, tile.tileIndex);
        const isSelected = refId === selectedTileRefId;
        return (
          <button
            key={`${tile.slot}:${tile.tileIndex}`}
            onClick={() => {
              EditorService.dispatch({
                type: 'SELECT_TILE_REF',
                tileRefId: refId,
                slot: tile.slot,
                tileIndex: tile.tileIndex,
              });
            }}
            style={{
              padding: 2,
              borderRadius: 4,
              border: `2px solid ${isSelected ? 'rgba(59,130,246,0.8)' : 'transparent'}`,
              background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              cursor: 'pointer',
            }}
          >
            <img
              src={tile.dataUrl}
              style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
            />
          </button>
        );
      })}
    </div>
  );
}
