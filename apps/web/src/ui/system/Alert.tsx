import * as React from 'react';

export type AlertIntent = 'success' | 'error' | 'warning' | 'info';

export type AlertProps = {
  intent: AlertIntent;
  children: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
};

export function Alert({ intent, children, onDismiss, style }: AlertProps) {
  const className = `sys-alert sys-alert--${intent}${onDismiss ? ' sys-alert--dismissable' : ''}`;

  return (
    <div className={className} style={style}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className="sys-alert__dismiss" onClick={onDismiss}>
          ×
        </button>
      )}
    </div>
  );
}
