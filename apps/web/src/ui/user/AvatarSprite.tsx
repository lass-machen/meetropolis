import React from 'react';
import { avatarRegistry } from '../../game/avatarRegistry';
import { useMemberAsset } from '../../hooks/useMemberAsset';
import { loadMemberImageElement } from '../../lib/memberImage';
import { isMemberAssetRef } from '../../lib/memberAssets';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { logger } from '../../lib/logger';

function resolveUrl(url: string): string {
  if (url.startsWith('/')) return `${getApiBaseFromWindow()}${url}`;
  return url;
}

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
    return <AvatarPreviewImage previewUrl={manifest.previewUrl} alt={avatarId} />;
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

// Stored member previews (/packs/..., /npc-media/...) load with member auth
// through useMemberAsset; bundled and local refs keep their direct URL.
function AvatarPreviewImage({ previewUrl, alt }: { previewUrl: string; alt: string }) {
  const member = isMemberAssetRef(previewUrl);
  const asset = useMemberAsset(member ? previewUrl : null);
  if (!member) {
    return (
      <img
        src={resolveUrl(previewUrl)}
        alt={alt}
        style={{
          imageRendering: 'pixelated',
          objectFit: 'contain',
          flexShrink: 0,
        }}
      />
    );
  }
  // Loading or failed: keep the same empty box the missing-avatar branch
  // renders instead of a broken image icon.
  if (asset.status !== 'ready' || !asset.src) {
    return <div style={{ flexShrink: 0 }} />;
  }
  return (
    <img
      src={asset.src}
      alt={alt}
      style={{
        imageRendering: 'pixelated',
        objectFit: 'contain',
        flexShrink: 0,
      }}
    />
  );
}

// Same unrenderable-sprite fallback the settings preview draws: a neutral
// box with a question mark instead of a broken image.
function drawSpritePlaceholder(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#555';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', canvas.width / 2, canvas.height / 2);
}

function AvatarSpriteCanvas({
  avatarId,
  frameWidth,
  frameHeight,
  displayWidth,
  displayHeight,
}: {
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

    // Stored member sheets load with member auth; bundled and local refs
    // pass through the helper untouched (resolveUrl keeps them absolute).
    const ref = isMemberAssetRef(spriteUrl) ? spriteUrl : resolveUrl(spriteUrl);
    const controller = new AbortController();
    let cancelled = false;
    let release: (() => void) | null = null;
    void loadMemberImageElement(ref, { signal: controller.signal }).then(
      ({ image, release: releaseHandle }) => {
        if (cancelled) {
          releaseHandle();
          return;
        }
        release = releaseHandle;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, idleRow * fh, frameWidth, fh, 0, 0, canvas.width, canvas.height);
      },
      () => {
        if (cancelled) return;
        logger.warn(`[AvatarSprite] Failed to load sprite: ${spriteUrl}`);
        drawSpritePlaceholder(canvas);
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
      release?.();
    };
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
