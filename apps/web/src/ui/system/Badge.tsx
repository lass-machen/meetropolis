import * as React from 'react';

export type BadgeIntent = 'default' | 'primary' | 'success' | 'danger' | 'warning';

export type BadgeProps = {
  intent?: BadgeIntent;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function Badge({ intent = 'default', children, style }: BadgeProps) {
  return (
    <span className={`sys-badge sys-badge--${intent}`} style={style}>
      {children}
    </span>
  );
}
