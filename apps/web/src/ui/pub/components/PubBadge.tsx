import React from 'react';

interface PubBadgeProps {
  variant?: 'purple' | 'teal' | 'pink' | 'amber' | 'dark';
  dot?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PubBadge({ variant = 'purple', dot = false, icon, children, className = '' }: PubBadgeProps) {
  const classes = ['pub-badge', `pub-badge--${variant}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes}>
      {dot && <span className="pub-badge__dot" />}
      {icon}
      {children}
    </span>
  );
}
