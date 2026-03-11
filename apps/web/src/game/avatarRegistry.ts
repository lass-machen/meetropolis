import Phaser from 'phaser';
import { getApiBaseFromWindow } from '../lib/apiBase';
import { logger } from '../lib/logger';

interface AvatarState {
  directions: ('down' | 'left' | 'right' | 'up')[];
  frameCount: number;
  frameRate: number;
  row: number;
}

export interface AvatarManifest {
  id: string;           // "packUuid:avatarKey"
  packUuid: string;
  avatarKey: string;
  displayName: string;
  type: 'full';
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  states: Record<string, AvatarState>;
  previewUrl?: string;
}

class AvatarRegistry {
  private manifests = new Map<string, AvatarManifest>();
  private loadedTextures = new Set<string>();

  async loadPacks(apiBase?: string): Promise<void> {
    const base = apiBase || getApiBaseFromWindow();
    try {
      const res = await fetch(`${base}/avatar-packs`, { credentials: 'include' });
      if (!res.ok) {
        logger.warn('[AvatarRegistry] Failed to fetch avatar packs:', res.status);
        this.ensureDefault();
        return;
      }
      const packs = await res.json();
      if (Array.isArray(packs)) {
        for (const pack of packs) {
          const avatars = Array.isArray(pack.avatars) ? pack.avatars : [];
          for (const avatar of avatars) {
            const id = `${pack.uuid}:${avatar.key}`;
            this.manifests.set(id, {
              id,
              packUuid: pack.uuid,
              avatarKey: avatar.key,
              displayName: avatar.displayName || avatar.key,
              type: 'full',
              spriteUrl: avatar.spriteUrl || `assets/sprites/${avatar.key}.png`,
              frameWidth: avatar.frameWidth || 16,
              frameHeight: avatar.frameHeight || 24,
              states: avatar.states || {
                idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
                walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
              },
              previewUrl: avatar.previewUrl,
            });
          }
        }
      }
    } catch (err) {
      logger.warn('[AvatarRegistry] Error loading packs:', err);
    }
    this.ensureDefault();
  }

  getManifest(avatarId: string): AvatarManifest | null {
    return this.manifests.get(avatarId) || null;
  }

  getDefaultAvatarId(): string {
    return 'default-characters:businessman1';
  }

  getAllAvatars(): AvatarManifest[] {
    return Array.from(this.manifests.values());
  }

  getTextureKey(avatarId: string): string {
    const [pack, key] = avatarId.split(':');
    return `avatar_${pack}_${key}`;
  }

  getAnimationKey(avatarId: string, state: string, direction: string): string {
    const [pack, key] = avatarId.split(':');
    return `avatar_${pack}_${key}_${state}_${direction}`;
  }

  private resolveAssetUrl(url: string): string {
    // Resolve server-relative URLs (e.g., /packs/avatars/...) to absolute API URLs.
    // Without this, Tauri resolves them to tauri://localhost/... which doesn't exist.
    if (url.startsWith('/')) {
      return `${getApiBaseFromWindow()}${url}`;
    }
    return url;
  }

  preloadAvatar(scene: Phaser.Scene, avatarId: string): void {
    const manifest = this.getManifest(avatarId);
    if (!manifest) return;
    const textureKey = this.getTextureKey(avatarId);
    if (this.loadedTextures.has(textureKey)) return;
    scene.load.spritesheet(textureKey, this.resolveAssetUrl(manifest.spriteUrl), {
      frameWidth: manifest.frameWidth,
      frameHeight: manifest.frameHeight,
    });
    this.loadedTextures.add(textureKey);
  }

  createAnimations(anims: Phaser.Animations.AnimationManager, avatarId: string): void {
    const manifest = this.getManifest(avatarId);
    if (!manifest) return;
    const textureKey = this.getTextureKey(avatarId);
    const cols = 4;

    for (const [stateName, state] of Object.entries(manifest.states)) {
      for (let dirIdx = 0; dirIdx < state.directions.length; dirIdx++) {
        const dir = state.directions[dirIdx];
        const animKey = this.getAnimationKey(avatarId, stateName, dir);
        if (anims.exists(animKey)) continue;

        const rowIndex = state.row + dirIdx;
        const startFrame = rowIndex * cols;
        const endFrame = startFrame + state.frameCount - 1;

        anims.create({
          key: animKey,
          frames: anims.generateFrameNumbers(textureKey, { start: startFrame, end: endFrame }),
          frameRate: state.frameRate,
          repeat: stateName === 'idle' ? 0 : -1,
        });
      }
    }
  }

  getIdleFrame(avatarId: string, direction: string): { texture: string; frame: number } {
    const textureKey = this.getTextureKey(avatarId);
    const manifest = this.getManifest(avatarId);
    if (!manifest) return { texture: textureKey, frame: 0 };

    const idleState = manifest.states['idle'];
    if (!idleState) return { texture: textureKey, frame: 0 };

    const dirIdx = idleState.directions.indexOf(direction as 'down' | 'left' | 'right' | 'up');
    const cols = 4;
    const row = idleState.row + (dirIdx >= 0 ? dirIdx : 0);
    return { texture: textureKey, frame: row * cols };
  }

  ensureDefault(): void {
    const defaultId = this.getDefaultAvatarId();
    if (!this.manifests.has(defaultId)) {
      this.manifests.set(defaultId, {
        id: defaultId,
        packUuid: 'default-characters',
        avatarKey: 'businessman1',
        displayName: 'Businessman',
        type: 'full',
        spriteUrl: 'assets/sprites/default-avatars.png',
        frameWidth: 16,
        frameHeight: 24,
        states: {
          idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
          walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
        },
      });
    }
  }
}

export const avatarRegistry = new AvatarRegistry();
