import * as React from 'react';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select(props: SelectProps) {
  const { className, style, ...rest } = props;
  const cls = ['sys-select', className].filter(Boolean).join(' ');
  return (
    <select className={cls} style={style} {...rest} />
  );
}
