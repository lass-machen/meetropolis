import * as React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  const { style, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        ...(style || {}),
        width: '100%',
        padding: '10px 12px',
        borderRadius: 'var(--radius-xs)',
        border: '1px solid var(--border)',
        background: 'var(--glass)',
        color: 'var(--fg)'
      }}
    />
  );
}


