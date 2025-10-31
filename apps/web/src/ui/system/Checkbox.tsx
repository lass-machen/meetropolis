import * as React from 'react';

export function Checkbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return (
    <input
      {...rest}
      type="checkbox"
      style={{
        width: 18,
        height: 18,
        appearance: 'none',
        WebkitAppearance: 'none',
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: props.checked ? 'var(--gradient-hero)' : 'var(--glass)',
        boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.2)'
        , cursor: 'pointer',
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style
      }}
    />
  );
}


