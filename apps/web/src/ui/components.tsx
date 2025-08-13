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

export function Button(props: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string; style?: React.CSSProperties }) {
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
      {props.children}
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


