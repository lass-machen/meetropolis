import * as React from 'react';

export function Slider(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, className, ...rest } = props;
  return <input {...rest} type="range" className={`sys-slider${className ? ` ${className}` : ''}`} style={style} />;
}
