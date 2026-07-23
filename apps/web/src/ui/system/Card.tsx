import * as React from 'react';

export type CardProps = {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export function Card(props: CardProps) {
  const cls = ['sys-card', props.className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={props.style}>
      {(props.title || props.actions) && (
        <div className="sys-card__header">
          {props.title && <div className="sys-card__title">{props.title}</div>}
          {props.actions}
        </div>
      )}
      {props.children}
    </div>
  );
}
