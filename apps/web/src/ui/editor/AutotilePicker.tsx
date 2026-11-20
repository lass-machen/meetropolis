import React from 'react';
import { EditorService } from '../../services/EditorService';
import type { AutotilePackItem } from '../../services/EditorTypes';
import { loadMemberImageElement } from '../../lib/memberImage';

export function AutotilePicker({
  autotileItems,
  selectedAutotile,
}: {
  autotileItems: AutotilePackItem[];
  selectedAutotile: { packUuid: string; autotileId: string } | null;
}) {
  if (autotileItems.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-subtle)', padding: '8px 0' }}>
        Keine Autotile-Definitionen verfügbar. Lade ein Asset Pack mit Autotiles hoch.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Wand-Typen</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 6 }}>
        {autotileItems.map((item) => (
          <AutotileThumbnail
            key={`${item.packUuid}:${item.autotileId}`}
            item={item}
            isSelected={selectedAutotile?.packUuid === item.packUuid && selectedAutotile.autotileId === item.autotileId}
          />
        ))}
      </div>
    </div>
  );
}

// Neutral fallback for an unloadable texture (401/403/404): the same
// question-mark box the avatar previews draw instead of a broken tile.
function drawAutotilePlaceholder(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#555';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 32, 32);
}

function AutotileThumbnail({ item, isSelected }: { item: AutotilePackItem; isSelected: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Stored member textures load with member auth; blob and data URLs
    // pass through the helper untouched. No crossOrigin: the helper serves
    // a blob URL, so a direct CORS load never happens.
    const controller = new AbortController();
    let cancelled = false;
    let release: (() => void) | null = null;
    void loadMemberImageElement(item.textureUrl, { signal: controller.signal }).then(
      ({ image, release: releaseHandle }) => {
        if (cancelled) {
          releaseHandle();
          return;
        }
        release = releaseHandle;
        // Show the bitmask-0 tile (isolated tile) as preview
        const variant = item.variants['0'];
        if (variant) {
          const srcX = variant.col * item.tileWidth;
          const srcY = variant.row * item.tileHeight;
          ctx.clearRect(0, 0, 64, 64);
          ctx.drawImage(image, srcX, srcY, item.tileWidth, item.tileHeight, 0, 0, 64, 64);
        }
      },
      () => {
        if (cancelled) return;
        drawAutotilePlaceholder(ctx);
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
      release?.();
    };
  }, [item]);

  return (
    <button
      onClick={() =>
        EditorService.dispatch({
          type: 'SELECT_WALL_TYPE',
          autotile: { packUuid: item.packUuid, autotileId: item.autotileId },
        })
      }
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
