import * as React from 'react';

export type ButtonVariant = 'primary' | 'brand' | 'ghost' | 'danger' | 'secondary';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export function Button(props: ButtonProps) {
  const { variant = 'ghost', leftIcon, rightIcon, className, style, ...rest } = props;
  const cls = ['sys-btn', `sys-btn--${variant}`, className].filter(Boolean).join(' ');
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
