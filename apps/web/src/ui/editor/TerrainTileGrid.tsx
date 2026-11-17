import { useRef, useEffect, useState, useCallback } from 'react';
import { EditorService } from '../../services/EditorService';
import { makeTileRefId, baseUrl } from '../../lib/mapV2';
import type { V2Tileset } from '../../lib/mapV2';
import type { PackItem } from '../../services/EditorService';
import { useMemberAsset } from '../../hooks/useMemberAsset';
import { loadMemberImageElement } from '../../lib/memberImage';
import { isMemberAssetRef } from '../../lib/memberAssets';

type TerrainTileGridProps = {
  v2Tilesets: V2Tileset[];
  selectedTileRefId: number;
  packTerrainItems?: PackItem[];
  pendingAsset?: { packUuid?: string | undefined; itemId?: string | undefined } | null;
};

type TileEntry = { slot: number; tileIndex: number; dataUrl: string };

function extractTiles(tileset: V2Tileset): Promise<TileEntry[]> {
  return (async (): Promise<TileEntry[]> => {
    // Stored member images load with member auth; other refs keep the
    // previous resolution (absolute, data:, blob:). No crossOrigin: the
    // helper serves a blob URL, so a direct CORS load never happens.
    const raw = tileset.imageUrl;
    const ref = isMemberAssetRef(raw) ? raw : raw.startsWith('/') ? baseUrl() + raw : raw;
    let loaded: { image: HTMLImageElement; release: () => void };
    try {
      loaded = await loadMemberImageElement(ref);
    } catch {
      return [];
    }
    const { image, release } = loaded;
    try {
      const tw = tileset.tileWidth;
      const th = tileset.tileHeight;
      const margin = tileset.margin ?? 0;
      const spacing = tileset.spacing ?? 0;
      const cols = Math.max(1, Math.floor((image.width - margin * 2 + spacing) / (tw + spacing)));
      const rows = Math.max(1, Math.floor((image.height - margin * 2 + spacing) / (th + spacing)));

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
          ctx.drawImage(image, sx, sy, tw, th, 0, 0, tw, th);
          entries.push({
            slot: tileset.slot,
            tileIndex: r * cols + c,
            dataUrl: canvas.toDataURL(),
          });
        }
      }
      return entries;
    } finally {
      release();
    }
  })();
}

function TileButton({ tile, isSelected }: { tile: TileEntry; isSelected: boolean }) {
  const refId = makeTileRefId(tile.slot, tile.tileIndex);
  return (
    <button
      onClick={() =>
        EditorService.dispatch({
          type: 'SELECT_TILE_REF',
          tileRefId: refId,
          slot: tile.slot,
          tileIndex: tile.tileIndex,
        })
      }
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
        alt={`Tile ${tile.tileIndex}`}
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
      />
    </button>
  );
}

// Pack items resolve server-relative /packs refs to absolute URLs at load
// time; those load with member auth, local data:/blob: URLs render direct.
// Loading or failed member refs keep an empty box instead of a broken image.
function PackItemButton({ item, selected }: { item: PackItem; selected: boolean }) {
  const member = isMemberAssetRef(item.dataUrl);
  const asset = useMemberAsset(member ? item.dataUrl : null);
  const src = member ? asset.src : item.dataUrl;
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
      {src ? (
        <img src={src} alt={item.key} style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }} />
      ) : (
        <div style={{ maxWidth: '100%', maxHeight: '100%' }} />
      )}
    </button>
  );
}

function useExtractedTiles(v2Tilesets: V2Tileset[]) {
  const [tiles, setTiles] = useState<TileEntry[]>([]);
  const loadedSlotsRef = useRef<string>('');

  const loadTiles = useCallback(async (tilesets: V2Tileset[]) => {
    const key = tilesets.map((t) => `${t.slot}:${t.key}`).join(',');
    if (key === loadedSlotsRef.current) return;
    loadedSlotsRef.current = key;
    const results = await Promise.all(tilesets.map(extractTiles));
    setTiles(results.flat());
  }, []);

  useEffect(() => {
    if (v2Tilesets.length > 0) void loadTiles(v2Tilesets);
  }, [v2Tilesets, loadTiles]);

  return tiles;
}

export function TerrainTileGrid({
  v2Tilesets,
  selectedTileRefId,
  packTerrainItems,
  pendingAsset,
}: TerrainTileGridProps) {
  const tiles = useExtractedTiles(v2Tilesets);
  const hasPackItems = packTerrainItems && packTerrainItems.length > 0;
  if (tiles.length === 0 && !hasPackItems) return null;

  return (
    <>
      {tiles.length > 0 && (
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
          {tiles.map((tile) => (
            <TileButton
              key={`${tile.slot}:${tile.tileIndex}`}
              tile={tile}
              isSelected={makeTileRefId(tile.slot, tile.tileIndex) === selectedTileRefId}
            />
          ))}
        </div>
      )}
      {hasPackItems && (
        <>
          {tiles.length > 0 && <div style={{ fontSize: 11, color: 'var(--fg-subtle)', marginTop: 4 }}>Pack Tiles</div>}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 8,
              maxHeight: 260,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--glass)',
              padding: 8,
            }}
          >
            {packTerrainItems.map((item) => (
              <PackItemButton
                key={`${item.packUuid}:${item.itemId}`}
                item={item}
                selected={pendingAsset?.itemId === item.itemId && pendingAsset?.packUuid === item.packUuid}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
