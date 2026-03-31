import React from 'react';

type PubButtonVariant = 'primary' | 'secondary' | 'ghost' | 'cta-white';
type PubButtonSize = 'sm' | 'md' | 'lg';

interface PubButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PubButtonVariant;
  size?: PubButtonSize;
  rightIcon?: React.ReactNode;
  leftIcon?: React.ReactNode;
  as?: 'button' | 'a';
  href?: string;
}

export function PubButton({
  variant = 'primary',
  size = 'md',
  rightIcon,
  leftIcon,
  as = 'button',
  href,
  children,
  className = '',
  ...rest
}: PubButtonProps) {
  const classes = [
    'pub-btn',
    `pub-btn--${variant}`,
    size !== 'md' ? `pub-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (as === 'a') {
    return (
      <a href={href} className={classes} role="button">
        {leftIcon && <span className="pub-btn__icon">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="pub-btn__icon">{rightIcon}</span>}
      </a>
    );
  }

  return (
    <button className={classes} {...rest}>
      {leftIcon && <span className="pub-btn__icon">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="pub-btn__icon">{rightIcon}</span>}
    </button>
  );
}
