import React from 'react';
import { avatarRegistry } from '../../game/avatarRegistry';

export function AvatarSprite({ avatarId, size = 12 }: { avatarId?: string; size?: number }) {
  const manifest = avatarId ? avatarRegistry.getManifest(avatarId) : null;
  const frameWidth = manifest?.frameWidth ?? 16;
  const frameHeight = manifest?.frameHeight ?? 24;
  const displayHeight = size;
  const displayWidth = Math.round((frameWidth / frameHeight) * size);

  if (!avatarId) {
    return <div style={{ width: displayWidth, height: displayHeight, flexShrink: 0 }} />;
  }

  if (manifest?.previewUrl) {
    return (
      <img
        src={manifest.previewUrl}
        alt={avatarId}
        style={{
          imageRendering: 'pixelated',
          objectFit: 'contain',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <AvatarSpriteCanvas
      avatarId={avatarId}
      frameWidth={frameWidth}
      frameHeight={frameHeight}
      displayWidth={displayWidth}
      displayHeight={displayHeight}
    />
  );
}

function AvatarSpriteCanvas({ avatarId, frameWidth, frameHeight, displayWidth, displayHeight }: {
  avatarId: string;
  frameWidth: number;
  frameHeight: number;
  displayWidth: number;
  displayHeight: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const manifest = avatarRegistry.getManifest(avatarId);
    if (!manifest) return;

    const { spriteUrl, frameHeight: fh } = manifest;
    const idleState = manifest.states['idle'];
    const idleRow = idleState ? idleState.row : 0;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, idleRow * fh, frameWidth, fh, 0, 0, canvas.width, canvas.height);
    };
    img.src = spriteUrl;
  }, [avatarId, frameWidth, frameHeight]);

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
