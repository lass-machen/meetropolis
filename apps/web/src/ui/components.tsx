import React from 'react';

export function Card(props: { title?: string; actions?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="glass-surface" style={{ padding: 16, borderRadius: 'var(--radius)', ...props.style }}>
      {(props.title || props.actions) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          {props.title && <div style={{ fontWeight: 700 }}>{props.title}</div>}
          {props.actions}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function Button(props: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string; style?: React.CSSProperties; leftIcon?: React.ReactNode; rightIcon?: React.ReactNode }) {
  const { variant = 'ghost' } = props;
  const base: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--glass)',
    color: 'var(--fg)',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.6 : 1,
  };
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-accent))',
      color: '#fff',
      border: 'none',
    },
    ghost: {
      background: 'var(--glass)'
    },
    danger: {
      background: 'rgba(244,63,94,0.15)',
      border: '1px solid rgba(244,63,94,0.45)',
      color: '#fff'
    }
  };
  return (
    <button title={props.title} onClick={props.onClick} disabled={props.disabled} style={{ ...base, ...styles[variant], ...props.style }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {props.leftIcon}
        {props.children}
        {props.rightIcon}
      </span>
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{
      ...(props.style || {}),
      width: '100%',
      padding: '10px 12px',
      borderRadius: 'var(--radius-xs)',
      border: '1px solid var(--border)',
      background: 'var(--glass)',
      color: 'var(--fg)'
    }} />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{
      ...(props.style || {}),
      width: '100%',
      padding: '10px 12px',
      borderRadius: 'var(--radius-xs)',
      border: '1px solid var(--border)',
      background: 'var(--glass)',
      color: 'var(--fg)'
    }} />
  );
}

export function Toolbar(props: { left?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="glass-surface" style={{ padding: 10, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...props.style }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{props.left ?? props.children}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{props.right}</div>
    </div>
  );
}

export function Modal(props: { open: boolean; title?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; maxWidth?: number }) {
  if (!props.open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }} onClick={props.onClose}>
      <div className="glass-surface" onClick={e => e.stopPropagation()} style={{ width: 'min(92vw, '+(props.maxWidth ?? 600)+'px)', borderRadius: 'var(--radius)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>{props.title}</div>
          <button onClick={props.onClose} title="Schließen" style={{ border: '1px solid var(--border)', background: 'var(--glass)', borderRadius: 'var(--radius-xs)', width: 32, height: 32, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {props.children}
        </div>
        {props.footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            {props.footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function TilesetPreview(props: {
  tileset: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number };
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { tileset, selectedIndex, onSelect } = props;
  const [imgEl, setImgEl] = React.useState<HTMLImageElement | null>(null);

  React.useEffect(() => {
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = tileset.dataUrl;
  }, [tileset.key, tileset.dataUrl]);

  if (!imgEl) return <div style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>Lade Tileset…</div>;
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


