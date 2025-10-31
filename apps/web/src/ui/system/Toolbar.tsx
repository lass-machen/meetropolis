import * as React from 'react';

export type ToolbarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

export function Toolbar(props: ToolbarProps) {
  return (
    <div className="glass-surface" style={{ padding: 10, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...props.style }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{props.left ?? props.children}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{props.right}</div>
    </div>
  );
}


