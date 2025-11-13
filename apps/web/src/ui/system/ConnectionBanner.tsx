import React from 'react';

export function ConnectionBanner(props: {
  reconnecting: boolean;
  reason?: string;
  minVisibleMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { reconnecting, reason, minVisibleMs = 1000, className = '', style } = props;
  const [show, setShow] = React.useState(false);
  const startedAtRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    let hideTimer: number | null = null;
    if (reconnecting) {
      startedAtRef.current = Date.now();
      setShow(true);
    } else {
      const startedAt = startedAtRef.current;
      if (!startedAt) {
        setShow(false);
      } else {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, minVisibleMs - elapsed);
        if (remaining <= 0) {
          setShow(false);
        } else {
          hideTimer = window.setTimeout(() => setShow(false), remaining);
        }
      }
    }
    return () => { if (hideTimer) clearTimeout(hideTimer); };
  }, [reconnecting, minVisibleMs]);
  if (!show) return null;
  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(17,17,20,0.85)',
        color: '#fff',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        ...style
      }}
      aria-live="polite"
    >
      <span style={{ width: 10, height: 10, borderRadius: 999, background: '#f59e0b', display: 'inline-block' }} />
      <div style={{ fontSize: 13, fontWeight: 600 }}>Verbindung wird wiederhergestellt…</div>
      {reason ? <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>({reason})</div> : null}
    </div>
  );
}


