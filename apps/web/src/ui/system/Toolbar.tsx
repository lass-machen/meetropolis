import * as React from 'react';

export type ToolbarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export function Toolbar(props: ToolbarProps) {
  const cls = ['sys-toolbar', props.className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={props.style}>
      <div className="sys-toolbar__left">{props.left ?? props.children}</div>
      <div className="sys-toolbar__right">{props.right}</div>
    </div>
  );
}
