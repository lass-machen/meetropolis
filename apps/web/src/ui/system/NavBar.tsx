import * as React from 'react';

export type NavBarProps = {
  left?: React.ReactNode;
  title?: string | React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export function NavBar({ left, title, right, style, className }: NavBarProps) {
  return (
    <div className={`sys-navbar${className ? ` ${className}` : ''}`} style={style}>
      <div className="sys-navbar__left">{left}</div>
      <div className="sys-navbar__title">
        {typeof title === 'string' ? <span>{title}</span> : title}
      </div>
      <div className="sys-navbar__right">{right}</div>
    </div>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
