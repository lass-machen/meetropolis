import type { AvatarConfig, SpriteCatalog } from '@meetropolis/shared';
import { PixelCanvas } from './PixelCanvas';
import { frontIdleFrame } from './spriteFrame';

/**
 * Live avatar preview rendered through the SAME shared composer the server uses,
 * so what the user sees is exactly the sheet that gets stored (no second
 * renderer, no drift). It stands on a grid whose cells are one sprite pixel —
 * the frame is 32x32 and the editor says so.
 */
export function AvatarLivePreview({ catalog, config }: { catalog: SpriteCatalog; config: AvatarConfig }) {
  const { frame_w: fw, frame_h: fh } = catalog.format;
  const frame = frontIdleFrame(catalog, config);

  return (
    <div className="av-ed__stage">
      <PixelCanvas frame={frame} width={fw} height={fh} className="av-ed__stage-canvas" />
    </div>
  );
}

export default AvatarLivePreview;
