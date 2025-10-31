import * as React from 'react';

export type ButtonVariant = 'primary' | 'brand' | 'ghost' | 'danger';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export function Button(props: ButtonProps) {
  const { variant = 'ghost', leftIcon, rightIcon, style, ...rest } = props;
  const base: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--glass)',
    color: 'var(--fg)',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.6 : 1,
  };
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-accent))',
      color: '#fff',
      border: 'none',
    },
    brand: {
      background: 'var(--gradient-hero)',
      color: '#fff',
      border: 'none',
    },
    ghost: {
      background: 'var(--glass)'
    },
    danger: {
      background: 'rgba(244,63,94,0.15)',
      border: '1px solid rgba(244,63,94,0.45)',
      color: '#fff'
    }
  };
  return (
    <button {...rest} style={{ ...base, ...styles[variant], ...style }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {leftIcon}
        {props.children}
        {rightIcon}
      </span>
    </button>
  );
}


