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
  id: string; // "packUuid:avatarKey"
  packUuid: string;
  avatarKey: string;
  displayName: string;
  type: 'full';
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  states: Record<string, AvatarState>;
  previewUrl?: string | undefined;
}

/**
 * Raw shape of an avatar entry inside an avatar-pack response. All fields are
 * optional because the server payload is hand-authored content and may be
 * missing values; defaults are filled in at registration time.
 */
interface AvatarPackEntry {
  key?: string;
  displayName?: string;
  spriteUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
  states?: Record<string, AvatarState>;
  previewUrl?: string;
}

/** Raw shape of a single pack entry inside `/avatar-packs`. */
interface AvatarPackResponseItem {
  uuid: string;
  avatars?: AvatarPackEntry[];
}

const CUSTOM_PREFIX = 'custom:';

export class AvatarRegistry {
  private manifests = new Map<string, AvatarManifest>();
  private loadedTextures = new Set<string>();

  // Custom-avatar (Phase 2 editor) manifest resolution. Default packs come from
  // loadPacks(); user-composed `custom:<uuid>` avatars are resolved lazily and
  // on demand from POST /avatars/resolve, then cached. In-flight de-duplication
  // and a negative cache keep a per-tick peer-load path from flooding the
  // endpoint; requests are coalesced into one batched call.
  private manifestInflight = new Map<string, Promise<AvatarManifest | null>>();
  private manifestNegativeUntil = new Map<string, number>();
  private pendingResolvers = new Map<string, (manifest: AvatarManifest | null) => void>();
  private resolveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly NEGATIVE_TTL_MS = 30_000;
  private static readonly RESOLVE_BATCH_MAX = 100;

  async loadPacks(apiBase?: string): Promise<void> {
    const base = apiBase || getApiBaseFromWindow();
    try {
      const res = await fetch(`${base}/avatar-packs`, { credentials: 'include' });
      if (!res.ok) {
        logger.warn('[AvatarRegistry] Failed to fetch avatar packs:', res.status);
        this.ensureDefault();
        return;
      }
      const packs: unknown = await res.json();
      if (Array.isArray(packs)) {
        for (const pack of packs as AvatarPackResponseItem[]) {
          const avatars: AvatarPackEntry[] = Array.isArray(pack.avatars) ? pack.avatars : [];
          for (const avatar of avatars) {
            const key = avatar.key ?? '';
            if (!key) continue;
            const id = `${pack.uuid}:${key}`;
            this.manifests.set(id, {
              id,
              packUuid: pack.uuid,
              avatarKey: key,
              displayName: avatar.displayName || key,
              type: 'full',
              spriteUrl: avatar.spriteUrl || `assets/sprites/${key}.png`,
              frameWidth: avatar.frameWidth || 32,
              frameHeight: avatar.frameHeight || 32,
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

  /** Register a manifest directly (e.g. the one returned by /me/avatar/compose). */
  registerManifest(manifest: AvatarManifest): void {
    this.manifests.set(manifest.id, manifest);
    this.manifestNegativeUntil.delete(manifest.id);
  }

  private isCustomAvatarId(avatarId: string): boolean {
    return avatarId.startsWith(CUSTOM_PREFIX);
  }

  /**
   * Resolve a custom avatar's manifest (lazily, deduped). Returns the cached
   * manifest immediately when known; otherwise queues a batched
   * POST /avatars/resolve and returns a promise. Non-custom or negatively
   * cached ids resolve to null without a request.
   */
  ensureManifest(avatarId: string, apiBase?: string): Promise<AvatarManifest | null> {
    const existing = this.manifests.get(avatarId);
    if (existing) return Promise.resolve(existing);
    if (!this.isCustomAvatarId(avatarId)) return Promise.resolve(null);
    const until = this.manifestNegativeUntil.get(avatarId);
    if (until !== undefined && until > Date.now()) return Promise.resolve(null);
    const inflight = this.manifestInflight.get(avatarId);
    if (inflight) return inflight;
    const promise = new Promise<AvatarManifest | null>((resolve) => {
      this.pendingResolvers.set(avatarId, resolve);
    });
    this.manifestInflight.set(avatarId, promise);
    this.scheduleResolveFlush(apiBase);
    return promise;
  }

  private scheduleResolveFlush(apiBase?: string): void {
    if (this.resolveTimer !== null) return;
    this.resolveTimer = setTimeout(() => {
      this.resolveTimer = null;
      void this.flushResolveQueue(apiBase);
    }, 0);
  }

  private async flushResolveQueue(apiBase?: string): Promise<void> {
    // Claim a batch synchronously (before awaiting) so a flush scheduled during
    // the fetch cannot double-process the same ids.
    const claimed = Array.from(this.pendingResolvers.entries()).slice(0, AvatarRegistry.RESOLVE_BATCH_MAX);
    for (const [id] of claimed) this.pendingResolvers.delete(id);
    if (claimed.length === 0) return;

    const base = apiBase || getApiBaseFromWindow();
    const resolved = await this.fetchManifests(
      base,
      claimed.map(([id]) => id),
    );
    const now = Date.now();
    for (const [id, resolve] of claimed) {
      const manifest = resolved[id] ?? null;
      if (manifest) this.registerManifest(manifest);
      else this.manifestNegativeUntil.set(id, now + AvatarRegistry.NEGATIVE_TTL_MS);
      this.manifestInflight.delete(id);
      resolve(manifest);
    }
    if (this.pendingResolvers.size > 0) this.scheduleResolveFlush(apiBase);
  }

  private async fetchManifests(base: string, ids: string[]): Promise<Record<string, AvatarManifest>> {
    try {
      const res = await fetch(`${base}/avatars/resolve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        logger.warn('[AvatarRegistry] resolve failed:', res.status);
        return {};
      }
      const data: unknown = await res.json();
      if (data && typeof data === 'object' && 'manifests' in data) {
        return (data as { manifests?: Record<string, AvatarManifest> }).manifests ?? {};
      }
      return {};
    } catch (err) {
      logger.warn('[AvatarRegistry] resolve error:', err);
      return {};
    }
  }

  getDefaultAvatarId(): string {
    return 'default-characters:business_man';
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
    const defaults: Array<{ key: string; displayName: string }> = [
      { key: 'business_man', displayName: 'Business Man' },
      { key: 'business_woman', displayName: 'Business Woman' },
      { key: 'casual_woman', displayName: 'Casual Woman' },
      { key: 'dev_hoodie', displayName: 'Developer' },
      { key: 'manager_woman', displayName: 'Manager' },
      { key: 'suit_man', displayName: 'Suit Man' },
    ];
    for (const def of defaults) {
      const id = `default-characters:${def.key}`;
      if (!this.manifests.has(id)) {
        this.manifests.set(id, {
          id,
          packUuid: 'default-characters',
          avatarKey: def.key,
          displayName: def.displayName,
          type: 'full',
          spriteUrl: `assets/sprites/${def.key}.png`,
          frameWidth: 32,
          frameHeight: 32,
          states: {
            idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
            walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
          },
        });
      }
    }
  }
}

export const avatarRegistry = new AvatarRegistry();
