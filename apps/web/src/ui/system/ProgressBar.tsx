import * as React from 'react';

export type ProgressBarIntent = 'default' | 'success' | 'warning' | 'danger';

export type ProgressBarProps = {
  value: number; // 0-100
  intent?: ProgressBarIntent;
  label?: React.ReactNode;
  style?: React.CSSProperties;
};

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function ProgressBar({ value, intent = 'default', label, style }: ProgressBarProps) {
  return (
    <div>
      <div className="sys-progress" style={style}>
        <div
          className={`sys-progress__fill sys-progress__fill--${intent}`}
          style={{ width: `${clamp(value, 0, 100)}%` }}
        />
      </div>
      {label && <div className="sys-progress__label">{label}</div>}
    </div>
  );
}
