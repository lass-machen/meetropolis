import React, { useRef, useEffect, useCallback } from 'react';
import { EditorService } from '../../services/EditorService';
import { makeTileRefId } from '../../lib/mapV2';
import type { V2Tileset } from '../../lib/mapV2';
import { baseUrl } from '../../lib/mapV2';

type TilesetPickerProps = {
  tileset: V2Tileset;
  selectedTileRefId: number;
};

/** Inline helper to avoid circular import with mapV2 */
function splitTileRefIdLocal(id: number): { slot: number; tileIndex: number } {
  if (id <= 0) return { slot: 0, tileIndex: 0 };
  const raw = id - 1;
  const slot = (raw >>> 16) & 0xffff;
  const tileIndex = raw & 0xffff;
  return { slot, tileIndex };
}

function useLoadImage(imageUrl: string) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const url = imageUrl.startsWith('/') ? `${baseUrl()}${imageUrl}` : imageUrl;
    img.onload = () => {
      imgRef.current = img;
      setLoaded(true);
    };
    img.onerror = () => setLoaded(false);
    img.src = url;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  return { imgRef, loaded };
}

function computeGrid(img: HTMLImageElement | null, tw: number, th: number, margin: number, spacing: number) {
  if (!img) return { cols: 0, rows: 0 };
  const cols = Math.max(1, Math.floor((img.width - margin * 2 + spacing) / (tw + spacing)));
  const rows = Math.max(1, Math.floor((img.height - margin * 2 + spacing) / (th + spacing)));
  return { cols, rows };
}

function drawTilesetCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cols: number,
  rows: number,
  tw: number,
  th: number,
  margin: number,
  spacing: number,
  scale: number,
  selectedTileRefId: number,
  slot: number,
) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);

  // Grid overlay
  ctx.strokeStyle = 'rgba(88, 101, 242, 0.3)';
  ctx.lineWidth = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.strokeRect(
        (margin + c * (tw + spacing)) * scale,
        (margin + r * (th + spacing)) * scale,
        tw * scale,
        th * scale,
      );
    }
  }

  // Highlight selected tile
  const { slot: selSlot, tileIndex } = splitTileRefIdLocal(selectedTileRefId);
  if (selectedTileRefId > 0 && selSlot === slot) {
    const selCol = tileIndex % cols;
    const selRow = Math.floor(tileIndex / cols);
    ctx.strokeStyle = 'rgba(88, 101, 242, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      (margin + selCol * (tw + spacing)) * scale,
      (margin + selRow * (th + spacing)) * scale,
      tw * scale,
      th * scale,
    );
    ctx.fillStyle = 'rgba(88, 101, 242, 0.2)';
    ctx.fillRect(
      (margin + selCol * (tw + spacing)) * scale,
      (margin + selRow * (th + spacing)) * scale,
      tw * scale,
      th * scale,
    );
  }
}

export function TilesetPicker({ tileset, selectedTileRefId }: TilesetPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { imgRef, loaded } = useLoadImage(tileset.imageUrl);

  const tw = tileset.tileWidth;
  const th = tileset.tileHeight;
  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  const scale = 2;

  const { cols, rows } = loaded ? computeGrid(imgRef.current, tw, th, margin, spacing) : { cols: 0, rows: 0 };

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;

    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawTilesetCanvas(ctx, img, cols, rows, tw, th, margin, spacing, scale, selectedTileRefId, tileset.slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: imgRef is a mutable ref (identity stable); the `loaded` flag already gates redraws after image-load, capturing the ref would be a no-op
  }, [loaded, selectedTileRefId, cols, rows, margin, spacing, tw, th, tileset.slot]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !loaded || cols === 0) return;

      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);

      const pixX = mx / scale - margin;
      const pixY = my / scale - margin;
      const col = Math.floor(pixX / (tw + spacing));
      const row = Math.floor(pixY / (th + spacing));

      if (col < 0 || col >= cols || row < 0 || row >= rows) return;

      const tileIndex = row * cols + col;
      const tileRefId = makeTileRefId(tileset.slot, tileIndex);

      EditorService.dispatch({
        type: 'SELECT_TILE_REF',
        tileRefId,
        slot: tileset.slot,
        tileIndex,
      });
    },
    [loaded, cols, rows, margin, spacing, tw, th, tileset.slot],
  );

  if (!loaded) {
    return <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: 8 }}>Tileset wird geladen...</div>;
  }

  const { slot: selSlot, tileIndex: selIdx } = splitTileRefIdLocal(selectedTileRefId);
  const showInfo = selectedTileRefId > 0 && selSlot === tileset.slot;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{
          cursor: 'crosshair',
          maxWidth: '100%',
          border: '1px solid var(--border)',
          borderRadius: 6,
          imageRendering: 'pixelated',
        }}
      />
      {showInfo && (
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', fontFamily: 'monospace' }}>
          Slot {selSlot} | Tile #{selIdx} | RefId {selectedTileRefId}
        </div>
      )}
    </div>
  );
}
