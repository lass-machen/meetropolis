import * as React from 'react';

export type TabItem = {
  key: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type TabsProps = {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  style?: React.CSSProperties;
  className?: string;
};

export function Tabs({ items, activeKey, onChange, style, className }: TabsProps) {
  return (
    <div className={`sys-tabs${className ? ` ${className}` : ''}`} style={style}>
      {items.map((item) => (
        <button
          key={item.key}
          className={`sys-tabs__tab${item.key === activeKey ? ' sys-tabs__tab--active' : ''}${item.disabled ? ' sys-tabs__tab--disabled' : ''}`}
          onClick={() => !item.disabled && onChange(item.key)}
          disabled={item.disabled}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
