import React from 'react';
import { FAIcon } from '../FAIcon';
import type { ButtonGroupItemSize, SeparatorVariant } from './types';

export function BGSeparator(props: {
  variant?: SeparatorVariant;
  size?: ButtonGroupItemSize;
  icon?: string;
  iconVariant?: 'solid' | 'regular' | 'brands';
  className?: string;
  style?: React.CSSProperties;
}) {
  const { variant = 'vertical', size, icon, iconVariant = 'solid', className = '', style } = props;
  const sizeClass = size === 'sm' ? 'bg-item-sm' : size === 'lg' ? 'bg-item-lg' : size === 'icon' ? 'bg-item-icon' : undefined;
  const classes = [
    variant === 'horizontal' ? 'bg-sep-horizontal' : (variant === 'icon' ? 'bg-sep-icon' : 'bg-sep-vertical'),
    sizeClass,
    className
  ].filter(Boolean).join(' ');
  if (variant === 'icon' && icon) {
    return (
      <div className={classes} style={style}>
        <FAIcon name={icon} variant={iconVariant} />
      </div>
    );
  }
  return <div className={classes} style={style} />;
}


