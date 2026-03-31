import React from 'react';

interface PubCardProps {
  variant?: 'surface' | 'dark' | 'purple';
  hover?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PubCard({
  variant = 'surface',
  hover = false,
  children,
  className = '',
  style,
}: PubCardProps) {
  const classes = [
    'pub-card',
    `pub-card--${variant}`,
    hover ? 'pub-card--hover' : '',
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
