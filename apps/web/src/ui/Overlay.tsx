import React from 'react';

type OverlayProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number | string;
  maxHeight?: number | string;
};

export function Overlay(props: OverlayProps) {
  const { open, title, onClose, right, children, maxWidth = 1100, maxHeight = '90vh' } = props;
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background:'rgba(0,0,0,0.78)', backdropFilter:'blur(3px)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e)=>e.stopPropagation()} style={{ width: `min(${typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth}, 96vw)`, maxHeight, overflow: 'auto', background: 'rgba(17,17,20,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 22px 64px rgba(0,0,0,0.5)' }}>
        {(title || right !== undefined) && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(17,17,20,0.98)' }}>
            <div style={{ fontWeight: 700, color: '#fff' }}>{title}</div>
            <div style={{ display: 'flex', alignItems:'center', gap: 8 }}>
              {right}
              <button onClick={onClose} title="Schließen" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.5)', color:'#fff', cursor:'pointer' }}>×</button>
            </div>
          </div>
        )}
        <div style={{ padding: 16 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
