import * as React from 'react';

export type DividerProps = {
  spacing?: number; // default 20
  style?: React.CSSProperties;
};

export function Divider({ spacing, style }: DividerProps) {
  const dynamicStyle: React.CSSProperties | undefined =
    spacing !== undefined || style
      ? { ...(spacing !== undefined ? { marginTop: spacing, marginBottom: spacing } : {}), ...style }
      : undefined;

  return <hr className="sys-divider" style={dynamicStyle} />;
}
