import React from 'react';
import type { ButtonGroupSpacerSize } from './types';

export function BGSpacer(props: { size?: ButtonGroupSpacerSize; className?: string; style?: React.CSSProperties }) {
  const { size = 'auto', className = '', style } = props;
  const sizeClass =
    size === 'grow'
      ? 'bg-spacer-grow'
      : size === 'shrink'
        ? 'bg-spacer-shrink'
        : size === 'fixedSm'
          ? 'bg-spacer-fixedSm'
          : size === 'fixedMd'
            ? 'bg-spacer-fixedMd'
            : size === 'fixedLg'
              ? 'bg-spacer-fixedLg'
              : 'bg-spacer-auto';
  const classes = [sizeClass, className].filter(Boolean).join(' ');
  return <div className={classes} style={style} />;
}
