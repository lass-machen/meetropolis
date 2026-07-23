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
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [reconnecting, minVisibleMs]);
  if (!show) return null;
  return (
    <div className={`sys-conn-banner ${className}`.trim()} style={style} aria-live="polite">
      <span className="sys-conn-banner__dot" />
      <div className="sys-conn-banner__label">Verbindung wird wiederhergestellt…</div>
      {reason ? <div className="sys-conn-banner__reason">({reason})</div> : null}
    </div>
  );
}
