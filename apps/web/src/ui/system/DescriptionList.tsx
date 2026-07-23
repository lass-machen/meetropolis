import * as React from 'react';

export type DescriptionItem = {
  label: React.ReactNode;
  value: React.ReactNode;
};

export type DescriptionListProps = {
  items: DescriptionItem[];
  columns?: 1 | 2;
  style?: React.CSSProperties;
  className?: string;
};

export function DescriptionList({ items, columns = 2, style, className }: DescriptionListProps) {
  return (
    <dl className={`sys-dl${className ? ` ${className}` : ''}`} style={style}>
      {items.map((item, i) => (
        <div key={i} className={`sys-dl__item${columns === 1 ? ' sys-dl__item--full' : ''}`}>
          <dt className="sys-dl__label">{item.label}</dt>
          <dd className="sys-dl__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
