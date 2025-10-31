import * as React from 'react';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select(props: SelectProps) {
  const { style, ...rest } = props;
  return (
    <select
      {...rest}
      style={{
        ...(style || {}),
        boxSizing: 'border-box',
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


