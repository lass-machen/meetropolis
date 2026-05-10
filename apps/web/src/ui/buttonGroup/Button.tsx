import React from 'react';
import { Icon, type IconName } from '../Icon';
import type { ButtonGroupItemSize, ButtonIconPosition, ButtonVariant } from './types';

export const BGButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonGroupItemSize;
  icon?: IconName;
  iconPosition?: ButtonIconPosition;
  active?: boolean;
}>((props, ref) => {
  const {
    variant = 'default',
    size,
    icon,
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

  const iconAriaLabel = typeof children === 'string' ? String(children) : undefined;

  return (
    <button ref={ref} className={classes} {...rest}>
      <span className="bg-button-content">
        {icon && (iconPosition === 'left' || iconPosition === 'only') && (
          <Icon name={icon} ariaLabel={iconAriaLabel} />
        )}
        {iconPosition !== 'only' && children}
        {icon && iconPosition === 'right' && (
          <Icon name={icon} ariaLabel={iconAriaLabel} />
        )}
      </span>
    </button>
  );
});

BGButton.displayName = 'BGButton';
