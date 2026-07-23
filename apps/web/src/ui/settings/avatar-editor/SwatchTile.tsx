import type { SpriteCatalog } from '@meetropolis/shared';
import { OptionTile } from './OptionTile';
import { paletteRampFor } from './editorLayout';

/**
 * A colour option shown as the palette the sprite is actually painted with:
 * highlight, mid and shadow side by side, brightest first. Showing the whole
 * ramp beats picking one representative colour — it is the real data, and it
 * reads as what it is, a pixel-art palette.
 */
export function SwatchTile({
  catalog,
  field,
  value,
  label,
  selected,
  disabled,
  onClick,
}: {
  catalog: SpriteCatalog;
  field: string;
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const ramp = paletteRampFor(catalog, field, value);

  return (
    <OptionTile selected={selected} disabled={disabled} label={label} onClick={onClick}>
      <span className="av-ed__tile-swatch">
        {ramp.map((hex, index) => (
          <span key={`${index}-${hex}`} style={{ background: hex }} />
        ))}
      </span>
    </OptionTile>
  );
}

export default SwatchTile;
