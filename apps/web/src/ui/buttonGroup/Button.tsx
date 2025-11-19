import React from 'react';
import { FAIcon } from '../FAIcon';
import type { ButtonGroupItemSize, ButtonIconPosition, ButtonVariant } from './types';

export const BGButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonGroupItemSize;
  icon?: string;
  iconVariant?: 'solid' | 'regular' | 'brands';
  iconPosition?: ButtonIconPosition;
  active?: boolean;
}>((props, ref) => {
  const {
    variant = 'default',
    size,
    icon,
    iconVariant = 'solid',
    iconPosition = 'left',
    active,
    children,
    className = '',
    ...rest
  } = props;

  const sizeClass = size === 'sm' ? 'bg-item-sm' : size === 'lg' ? 'bg-item-lg' : size === 'icon' ? 'bg-item-icon' : undefined;
  const variantClass = variant === 'primary' ? 'bg-btn-primary' : variant === 'secondary' ? 'bg-btn-secondary' : 'bg-btn-default';
  const activeClass = active ? 'bg-btn-active' : '';
  const iconOnly = icon && iconPosition === 'only' && !children;
  const iconOnlyClass = iconOnly ? 'bg-icon-only' : '';

  const classes = ['bg-button', variantClass, activeClass, sizeClass, iconOnlyClass, className].filter(Boolean).join(' ');

  return (
    <button ref={ref} className={classes} {...rest}>
      <span className="bg-button-content">
        {icon && (iconPosition === 'left' || iconPosition === 'only') && (
          <FAIcon name={icon} variant={iconVariant} ariaLabel={typeof children === 'string' ? String(children) : undefined} />
        )}
        {iconPosition !== 'only' && children}
        {icon && iconPosition === 'right' && (
          <FAIcon name={icon} variant={iconVariant} ariaLabel={typeof children === 'string' ? String(children) : undefined} />
        )}
      </span>
    </button>
  );
});

BGButton.displayName = 'BGButton';


