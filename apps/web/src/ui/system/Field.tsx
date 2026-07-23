import * as React from 'react';

export function FieldRow(props: {
  label: React.ReactNode;
  control: React.ReactNode;
  hint?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { label, control, hint, style } = props;
  return (
    <div className="sys-field" style={style}>
      <div>
        <div className="sys-field__label">{label}</div>
        {hint && <div className="sys-field__hint">{hint}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}
