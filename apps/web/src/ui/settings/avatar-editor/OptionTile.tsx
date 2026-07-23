import React from 'react';

/**
 * The shared shell of a picker option: the frame, the selected/disabled state
 * and the caption. Swatch and sprite tiles only supply what goes inside, so
 * both stay visually identical apart from their content.
 */
export function OptionTile({
  selected,
  disabled,
  label,
  none,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  label: string;
  /** The "wear nothing" option: dashed outline, the convention for empty. */
  none?: boolean | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`av-ed__tile${none ? ' av-ed__tile--none' : ''}${selected ? ' av-ed__tile--selected' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {children}
      <span className="av-ed__tile-caption">{label}</span>
    </button>
  );
}

export default OptionTile;
