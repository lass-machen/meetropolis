import * as React from 'react';

export function Slider(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return (
    <input
      {...rest}
      type="range"
      style={{
        WebkitAppearance: 'none',
        width: 220,
        height: 4,
        borderRadius: 999,
        background: 'var(--gradient-hero)',
        outline: 'none',
        cursor: 'pointer',
        ...style
      }}
    />
  );
}


