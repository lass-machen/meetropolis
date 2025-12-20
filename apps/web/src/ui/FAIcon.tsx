import React from 'react';

type FAStyle = 'solid' | 'regular' | 'brands';

export type FAIconProps = {
  name: string;
  variant?: FAStyle;
  className?: string;
  title?: string;
  ariaLabel?: string | undefined;
  size?: 'sm' | 'lg' | 'xl' | '2x' | '3x' | 'xs';
  fixedWidth?: boolean;
  style?: React.CSSProperties;
};

export function FAIcon({ name, variant = 'solid', className = '', title, ariaLabel, size, fixedWidth, style }: FAIconProps) {
  const classes = [
    `fa-${variant}`,
    `fa-${name}`,
    size ? `fa-${size}` : '',
    fixedWidth ? 'fa-fw' : '',
    className
  ].filter(Boolean).join(' ');
  return (
    <i
      className={classes}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      title={title}
      style={style}
    />
  );
}


