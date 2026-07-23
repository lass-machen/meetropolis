import { Ban } from 'lucide-react';
import type { AvatarConfig, SpriteCatalog } from '@meetropolis/shared';
import { OptionTile } from './OptionTile';
import { PixelCanvas } from './PixelCanvas';
import { frontIdleFrame } from './spriteFrame';

/**
 * An item option shown as the avatar itself wearing it: the tile renders the
 * config the click would produce, so the item appears in context (current skin,
 * hair colour, outfit) and the tile is a literal preview of the outcome.
 * Rendering is memoised in spriteFrame's cache, keyed by the config's canonical
 * identity.
 *
 * An option that is invalid in the current combination (the hood needs a top
 * palette, so it has no sheet under the base outfit) has nothing to preview.
 * It shows an unavailable marker rather than an empty cell: rendering the
 * avatar WITHOUT the item would advertise an outcome the click cannot produce.
 */
export function SpriteTile({
  catalog,
  previewConfig,
  label,
  selected,
  disabled,
  none,
  onClick,
}: {
  catalog: SpriteCatalog;
  previewConfig: AvatarConfig;
  label: string;
  selected: boolean;
  disabled: boolean;
  none?: boolean | undefined;
  onClick: () => void;
}) {
  const { frame_w: fw, frame_h: fh } = catalog.format;
  const frame = frontIdleFrame(catalog, previewConfig);

  return (
    <OptionTile selected={selected} disabled={disabled} label={label} none={none} onClick={onClick}>
      {frame === null ? (
        <span className="av-ed__tile-unavailable" role="img" aria-label={`${label}: nicht verfügbar`}>
          <Ban size={24} strokeWidth={1.5} aria-hidden="true" />
        </span>
      ) : (
        <PixelCanvas frame={frame} width={fw} height={fh} className="av-ed__tile-sprite" />
      )}
    </OptionTile>
  );
}

export default SpriteTile;
