import * as React from 'react';

export type ButtonVariant = 'primary' | 'brand' | 'ghost' | 'danger' | 'secondary';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export function Button(props: ButtonProps) {
  const { variant = 'ghost', size = 'md', leftIcon, rightIcon, className, style, ...rest } = props;
  const cls = ['sys-btn', `sys-btn--${variant}`, `sys-btn--${size}`, className].filter(Boolean).join(' ');
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
