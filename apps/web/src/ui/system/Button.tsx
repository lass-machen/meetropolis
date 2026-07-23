import * as React from 'react';

export type ButtonVariant = 'primary' | 'brand' | 'ghost' | 'danger' | 'secondary';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export function Button(props: ButtonProps) {
  const { variant = 'ghost', size = 'md', iconOnly, leftIcon, rightIcon, className, style, ...rest } = props;
  const cls = ['sys-btn', `sys-btn--${variant}`, `sys-btn--${size}`, iconOnly && 'sys-btn--icon-only', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} style={style} {...rest}>
      <span className="sys-btn__icon">
        {leftIcon}
        {props.children}
        {rightIcon}
      </span>
    </button>
  );
}
