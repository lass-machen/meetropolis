import * as React from 'react';

export function TableContainer(props: { maxHeight?: number | string; style?: React.CSSProperties; children: React.ReactNode }) {
  const { maxHeight = 'auto', style, children } = props;
  return (
    <div style={{ overflow: 'auto', maxHeight, ...style }}>
      {children}
    </div>
  );
}

export function Table(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, ...props.style }}>
      {props.children}
    </table>
  );
}

export function THead(props: { sticky?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  const { sticky, children, style } = props;
  return (
    <thead style={sticky ? { position: 'sticky', top: 0, background: 'var(--glass)', zIndex: 1, ...style } : style}>
      {children}
    </thead>
  );
}

export function TBody(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <tbody style={props.style}>{props.children}</tbody>;
}

export function Tr(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <tr style={props.style}>{props.children}</tr>;
}

export function Th(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--fg-subtle)', fontSize: 12, ...props.style }}>{props.children}</th>;
}

export function Td(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 12px', ...props.style }}>{props.children}</td>;
}


