import { useRef, useEffect, useState, useCallback } from 'react';
import { EditorService } from '../../services/EditorService';
import { makeTileRefId, baseUrl } from '../../lib/mapV2';
import type { V2Tileset } from '../../lib/mapV2';
import type { PackItem } from '../../services/EditorService';

type TerrainTileGridProps = {
  v2Tilesets: V2Tileset[];
  selectedTileRefId: number;
  packTerrainItems?: PackItem[];
  pendingAsset?: { packUuid?: string | undefined; itemId?: string | undefined } | null;
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

function TileButton({ tile, isSelected }: { tile: TileEntry; isSelected: boolean }) {
  const refId = makeTileRefId(tile.slot, tile.tileIndex);
  return (
    <button
      onClick={() => EditorService.dispatch({ type: 'SELECT_TILE_REF', tileRefId: refId, slot: tile.slot, tileIndex: tile.tileIndex })}
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
      <img src={tile.dataUrl} style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
    </button>
  );
}

function PackItemButton({ item, selected }: { item: PackItem; selected: boolean }) {
  return (
    <button
      onClick={() => EditorService.dispatch({ type: 'SELECT_ASSET', asset: item })}
      title={item.key}
      style={{
        padding: 4,
        borderRadius: 8,
        border: `1px solid ${selected ? 'rgba(59,130,246,0.8)' : 'var(--border)'}`,
        background: selected ? 'rgba(59,130,246,0.12)' : 'var(--glass)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 64,
        cursor: 'pointer',
      }}
    >
      <img src={item.dataUrl} alt={item.key} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }} />
    </button>
  );
}

function useExtractedTiles(v2Tilesets: V2Tileset[]) {
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

  return tiles;
}

export function TerrainTileGrid({ v2Tilesets, selectedTileRefId, packTerrainItems, pendingAsset }: TerrainTileGridProps) {
  const tiles = useExtractedTiles(v2Tilesets);
  const hasPackItems = packTerrainItems && packTerrainItems.length > 0;
  if (tiles.length === 0 && !hasPackItems) return null;

  return (
    <>
      {tiles.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 4, maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)', padding: 8 }}>
          {tiles.map((tile) => (
            <TileButton key={`${tile.slot}:${tile.tileIndex}`} tile={tile} isSelected={makeTileRefId(tile.slot, tile.tileIndex) === selectedTileRefId} />
          ))}
        </div>
      )}
      {hasPackItems && (
        <>
          {tiles.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4 }}>Pack Tiles</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8, maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)', padding: 8 }}>
            {packTerrainItems!.map(item => (
              <PackItemButton key={`${item.packUuid}:${item.itemId}`} item={item} selected={pendingAsset?.itemId === item.itemId && pendingAsset?.packUuid === item.packUuid} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
