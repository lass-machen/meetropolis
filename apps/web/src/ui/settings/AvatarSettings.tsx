import React from 'react';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { logger } from '../../lib/logger';

interface AvatarSettingsProps {
  currentAvatarId: string;
  onAvatarChange: (avatarId: string) => void;
}

interface AvatarOption {
  id: string;
  displayName: string;
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  idleRow: number;
}

export function AvatarSettings({ currentAvatarId, onAvatarChange }: AvatarSettingsProps) {
  const [avatars, setAvatars] = React.useState<AvatarOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  const apiBase = getApiBaseFromWindow();

  React.useEffect(() => {
    const fetchAvatars = async () => {
      try {
        const res = await fetch(`${apiBase}/avatar-packs`, { credentials: 'include' });
        if (res.ok) {
          const packs = await res.json();
          const list: AvatarOption[] = [];
          if (Array.isArray(packs)) {
            for (const pack of packs) {
              const packAvatars = Array.isArray(pack.avatars) ? pack.avatars : [];
              for (const av of packAvatars) {
                list.push({
                  id: `${pack.uuid}:${av.key}`,
                  displayName: av.displayName || av.key,
                  spriteUrl: av.spriteUrl || `assets/sprites/${av.key}.png`,
                  frameWidth: av.frameWidth || 16,
                  frameHeight: av.frameHeight || 24,
                  idleRow: av.states?.idle?.row ?? 0,
                });
              }
            }
          }
          if (list.length === 0) {
            list.push({
              id: 'default-characters:businessman1',
              displayName: 'Businessman',
              spriteUrl: 'assets/sprites/default-avatars.png',
              frameWidth: 16,
              frameHeight: 24,
              idleRow: 0,
            });
          }
          setAvatars(list);
        }
      } catch (err) {
        logger.warn('[AvatarSettings] Failed to fetch avatar packs:', err);
        setAvatars([{
          id: 'default-characters:businessman1',
          displayName: 'Businessman',
          spriteUrl: 'assets/sprites/default-avatars.png',
          frameWidth: 16,
          frameHeight: 24,
          idleRow: 0,
        }]);
      } finally {
        setLoading(false);
      }
    };
    fetchAvatars();
  }, [apiBase]);

  if (loading) {
    return <div style={styles.loading}>Loading avatars...</div>;
  }

  return (
    <div style={styles.grid}>
      {avatars.map((av) => (
        <button
          key={av.id}
          onClick={() => onAvatarChange(av.id)}
          style={{
            ...styles.card,
            ...(av.id === currentAvatarId ? styles.cardSelected : {}),
          }}
          title={av.displayName}
        >
          <AvatarPreview
            spriteUrl={av.spriteUrl}
            frameWidth={av.frameWidth}
            frameHeight={av.frameHeight}
            idleRow={av.idleRow}
          />
          <div style={styles.cardLabel}>{av.displayName}</div>
        </button>
      ))}
    </div>
  );
}

function AvatarPreview({ spriteUrl, frameWidth, frameHeight, idleRow }: { spriteUrl: string; frameWidth: number; frameHeight: number; idleRow: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw first frame of the avatar's idle row
      ctx.drawImage(img, 0, idleRow * frameHeight, frameWidth, frameHeight, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      logger.warn(`[AvatarPreview] Failed to load sprite: ${spriteUrl}`);
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
    };
    img.src = spriteUrl;
  }, [spriteUrl, frameWidth, frameHeight, idleRow]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={96}
      style={styles.preview}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    background: 'rgba(255,255,255,0.05)',
    border: '2px solid transparent',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  cardSelected: {
    borderColor: 'var(--accent, #3b82f6)',
    background: 'rgba(59,130,246,0.1)',
  },
  cardLabel: {
    fontSize: 11,
    color: 'var(--fg-subtle, #888)',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  preview: {
    imageRendering: 'pixelated',
    width: 48,
    height: 72,
  },
  loading: {
    padding: 20,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
    fontSize: 13,
  },
};

export default AvatarSettings;
