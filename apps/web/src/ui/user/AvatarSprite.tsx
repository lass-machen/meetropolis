import React from 'react';
import { avatarRegistry } from '../../game/avatarRegistry';

export function AvatarSprite({ avatarId, size = 12 }: { avatarId?: string; size?: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !avatarId) return;

    const manifest = avatarRegistry.getManifest(avatarId);
    if (!manifest) return;

    const { spriteUrl, frameWidth, frameHeight } = manifest;
    const idleState = manifest.states['idle'];
    const idleRow = idleState ? idleState.row : 0;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw first frame of idle-down (row = idleRow, col = 0)
      ctx.drawImage(img, 0, idleRow * frameHeight, frameWidth, frameHeight, 0, 0, canvas.width, canvas.height);
    };
    img.src = spriteUrl;
  }, [avatarId]);

  // Display at full `size` height, scale width proportionally
  const manifest = avatarId ? avatarRegistry.getManifest(avatarId) : null;
  const frameWidth = manifest?.frameWidth ?? 16;
  const frameHeight = manifest?.frameHeight ?? 24;
  const displayHeight = size;
  const displayWidth = Math.round((frameWidth / frameHeight) * size);

  if (!avatarId) {
    return <div style={{ width: displayWidth, height: displayHeight, flexShrink: 0 }} />;
  }

  return (
    <canvas
      ref={canvasRef}
      width={frameWidth}
      height={frameHeight}
      style={{
        width: displayWidth,
        height: displayHeight,
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}
