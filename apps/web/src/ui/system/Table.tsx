import * as React from 'react';

export function TableContainer(props: { maxHeight?: number | string; style?: React.CSSProperties; className?: string; children: React.ReactNode }) {
  const { maxHeight, style, className, children } = props;
  const cls = ['sys-table-container', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ maxHeight, ...style }}>
      {children}
    </div>
  );
}

export function Table(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const cls = ['sys-table', props.className].filter(Boolean).join(' ');
  return (
    <table className={cls} style={props.style}>
      {props.children}
    </table>
  );
}

export function THead(props: { sticky?: boolean; children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const { sticky, children, style, className } = props;
  const cls = [sticky ? 'sys-thead--sticky' : undefined, className].filter(Boolean).join(' ') || undefined;
  return (
    <thead className={cls} style={style}>
      {children}
    </thead>
  );
}

export function TBody(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return <tbody className={props.className} style={props.style}>{props.children}</tbody>;
}

export function Tr(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return <tr className={props.className} style={props.style}>{props.children}</tr>;
}

export function Th(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const cls = ['sys-th', props.className].filter(Boolean).join(' ');
  return <th className={cls} style={props.style}>{props.children}</th>;
}

export function Td(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const cls = ['sys-td', props.className].filter(Boolean).join(' ');
  return <td className={cls} style={props.style}>{props.children}</td>;
}
