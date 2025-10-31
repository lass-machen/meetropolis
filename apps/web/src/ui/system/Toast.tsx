import * as React from 'react';

export type ToastProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  intent?: 'info' | 'success' | 'error';
};

export function Toast(props: ToastProps) {
  const { open, onOpenChange, title, description, intent = 'info' } = props;
  if (!open) return null;
  const border = intent === 'success' ? 'rgba(16,185,129,0.45)' : intent === 'error' ? 'rgba(244,63,94,0.45)' : 'var(--border)';
  const bg = intent === 'success' ? 'rgba(16,185,129,0.15)' : intent === 'error' ? 'rgba(244,63,94,0.15)' : 'var(--glass)';
  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 120 }}>
      <div style={{ display: 'grid', gap: 6, minWidth: 240, maxWidth: 420, padding: 12, borderRadius: 10, border: `1px solid ${border}`, background: bg, color: 'var(--fg)', boxShadow: 'var(--shadow)' }}>
        {title && <div style={{ fontWeight: 700 }}>{title}</div>}
        {description && <div style={{ fontSize: 13, color: 'var(--fg-subtle)' }}>{description}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => onOpenChange(false)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Schließen</button>
        </div>
      </div>
    </div>
  );
}


