import React from 'react';
import { EditorService } from '../../services/EditorService';
import type { AutotilePackItem } from '../../services/EditorTypes';

export function AutotilePicker({
  autotileItems,
  selectedWallTypeId,
}: {
  autotileItems: AutotilePackItem[];
  selectedWallTypeId: number;
}) {
  if (autotileItems.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '8px 0' }}>
        Keine Autotile-Definitionen verfuegbar. Lade ein Asset Pack mit Autotiles hoch.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
        Wand-Typen
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 }}>
        {autotileItems.map((item) => (
          <AutotileThumbnail
            key={`${item.packUuid}:${item.autotileId}`}
            item={item}
            isSelected={selectedWallTypeId === item.wallTypeId}
          />
        ))}
      </div>
    </div>
  );
}

function AutotileThumbnail({ item, isSelected }: { item: AutotilePackItem; isSelected: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Show the bitmask-0 tile (isolated tile) as preview
      const variant = item.variants['0'];
      if (variant) {
        const srcX = variant.col * item.tileWidth;
        const srcY = variant.row * item.tileHeight;
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, srcX, srcY, item.tileWidth, item.tileHeight, 0, 0, 64, 64);
      }
    };
    img.src = item.textureUrl;
  }, [item]);

  return (
    <button
      onClick={() => EditorService.dispatch({ type: 'SELECT_WALL_TYPE', wallTypeId: item.wallTypeId })}
      style={{
        width: 64,
        height: 64,
        padding: 0,
        border: isSelected ? '2px solid #3b82f6' : '2px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.3)',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
      title={item.key}
    >
      <canvas ref={canvasRef} width={64} height={64} style={{ display: 'block', width: '100%', height: '100%' }} />
    </button>
  );
}
