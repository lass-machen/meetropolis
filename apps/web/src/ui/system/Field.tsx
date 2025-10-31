import * as React from 'react';

export function FieldRow(props: { label: React.ReactNode; control: React.ReactNode; hint?: React.ReactNode; style?: React.CSSProperties }) {
  const { label, control, hint, style } = props;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, ...style }}>
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{hint}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}


