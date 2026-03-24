import * as React from 'react';

export type SectionProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function Section({ title, description, actions, children, style }: SectionProps) {
  return (
    <div className="sys-section" style={style}>
      <div className="sys-section__header">
        <div>
          <h3 className="sys-section__title">{title}</h3>
          {description && <p className="sys-section__desc">{description}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
      {children}
    </div>
  );
}
