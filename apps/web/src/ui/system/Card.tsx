import * as React from 'react';

export type CardProps = {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function Card(props: CardProps) {
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


