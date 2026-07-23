import React from 'react';
import type { ButtonGroupItemSize } from './types';

export function ButtonGroup(props: {
  children: React.ReactNode;
  orientation?: 'horizontal' | 'vertical';
  size?: ButtonGroupItemSize;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { children, orientation = 'horizontal', size = 'md', className = '', style } = props;
  const classes = [
    'bg-container',
    orientation === 'vertical' ? 'bg-vertical' : 'bg-horizontal',
    size === 'sm'
      ? 'bg-item-sm bg-container-pad-sm'
      : size === 'lg'
        ? 'bg-item-lg bg-container-pad-lg'
        : size === 'icon'
          ? 'bg-item-icon bg-container-pad-icon'
          : 'bg-item-md bg-container-pad-md',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
