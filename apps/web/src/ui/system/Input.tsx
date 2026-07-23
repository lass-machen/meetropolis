import * as React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input(props: InputProps) {
  const { className, style, ...rest } = props;
  const cls = ['sys-input', className].filter(Boolean).join(' ');
  return <input className={cls} style={style} {...rest} />;
}
