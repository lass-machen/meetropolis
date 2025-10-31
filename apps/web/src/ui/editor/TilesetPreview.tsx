import React from 'react';
import { useTranslation } from 'react-i18next';

export function TilesetPreview(props: {
  tileset: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number };
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { tileset, selectedIndex, onSelect } = props;
  const [imgEl, setImgEl] = React.useState<HTMLImageElement | null>(null);
  const { t } = useTranslation();

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = tileset.dataUrl;
  }, [tileset.key, tileset.dataUrl]);

  if (!imgEl) return <div style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{t('tileset.loading')}</div>;
  const margin = tileset.margin || 0;
  const spacing = tileset.spacing || 0;
  const cols = Math.max(1, Math.floor((imgEl.width - margin + spacing) / (tileset.tileWidth + spacing)));
  const rows = Math.max(1, Math.floor((imgEl.height - margin + spacing) / (tileset.tileHeight + spacing)));
  const total = Math.max(0, cols * rows);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cols, 8)}, ${tileset.tileWidth + 8}px)`, gap: 6, maxHeight: 240, overflow: 'auto', padding: 4, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--glass)' }}>
      {Array.from({ length: total }).map((_, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        const sx = margin + c * (tileset.tileWidth + spacing);
        const sy = margin + r * (tileset.tileHeight + spacing);
        const isSel = idx === selectedIndex;
        return (
          <div key={idx} style={{ display: 'grid', gap: 4 }}>
            <button onClick={() => onSelect(idx)} style={{ width: tileset.tileWidth + 8, height: tileset.tileHeight + 8, padding: 0, borderRadius: 6, border: isSel ? '2px solid #22d3ee' : '1px solid var(--border)', background: 'transparent', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ width: tileset.tileWidth, height: tileset.tileHeight, backgroundImage: `url(${tileset.dataUrl})`, backgroundPosition: `-${sx}px -${sy}px`, backgroundRepeat: 'no-repeat' }} />
            </button>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--fg-subtle)' }}>{idx}</div>
          </div>
        );
      })}
    </div>
  );
}


