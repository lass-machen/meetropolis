import * as React from 'react';

export function Checkbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, className, ...rest } = props;
  return (
    <input {...rest} type="checkbox" className={`sys-checkbox${className ? ` ${className}` : ''}`} style={style} />
  );
}
