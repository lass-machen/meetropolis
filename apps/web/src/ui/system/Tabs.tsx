import * as React from 'react';

export type TabItem = { key: string; label: React.ReactNode };

export type TabsProps = {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  style?: React.CSSProperties;
  className?: string;
};

export function Tabs({ items, activeKey, onChange, style, className }: TabsProps) {
  const cls = ['sys-tabs', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`sys-tabs__tab${item.key === activeKey ? ' sys-tabs__tab--active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
