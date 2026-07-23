import Phaser from 'phaser';
import { avatarRegistry } from '../../avatarRegistry';
import { actorFootDepth } from './depthConstants';

export interface RemotePlayer {
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  prevX?: number | undefined;
  prevY?: number | undefined;
  name?: string | undefined;
  dnd?: boolean | undefined;
  avatarId?: string | undefined;
  isNpc?: boolean | undefined;
}

/**
 * Per-remote sprite metadata stored directly on the Phaser Sprite instance.
 * Used by the avatar animation / standing detection logic.
 */
type RemoteSprite = Phaser.GameObjects.Sprite & {
  prevX?: number;
  prevY?: number;
  prevDirection?: string;
  lastMoveTime?: number;
  avatarId?: string;
  isStanding?: boolean;
  // Last applied y-sort depth; guards against a redundant setDepth + re-sort.
  lastDepth?: number;
};

export class RemotePlayersManager {
  private scene: Phaser.Scene;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private loadingAvatars: Set<string> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  syncRemotePlayers(players: Record<string, RemotePlayer>, localSessionId?: string) {
    for (const [id, p] of Object.entries(players)) {
      if (localSessionId && id === localSessionId) continue;

      let s = this.remotes.get(id);
      if (!s) {
        s = this.createRemoteSprite(id, p);
      }

      this.updateRemotePlayer(s, p);
    }

    this.cleanupMissingPlayers(Object.keys(players));
  }

  private createRemoteSprite(id: string, p: RemotePlayer): Phaser.GameObjects.Sprite {
    const remoteAvatarId = p.avatarId || avatarRegistry.getDefaultAvatarId();
    const textureKey = avatarRegistry.getTextureKey(remoteAvatarId);
    const textureReady = this.scene.textures.exists(textureKey);

    // Use the requested avatar if loaded, otherwise fall back to default
    const initialAvatarId = textureReady ? remoteAvatarId : avatarRegistry.getDefaultAvatarId();
    avatarRegistry.createAnimations(this.scene.anims, initialAvatarId);
    const { texture, frame } = avatarRegistry.getIdleFrame(initialAvatarId, p.direction || 'down');
    const s = this.scene.add.sprite(p.x, p.y, texture, frame) as RemoteSprite;
    this.applyDepth(s);

    s.prevX = p.x;
    s.prevY = p.y;
    s.prevDirection = p.direction;
    s.lastMoveTime = Date.now();
    s.avatarId = initialAvatarId;

    this.remotes.set(id, s);

    // If the desired avatar wasn't loaded, start loading it asynchronously
    if (!textureReady) {
      this.ensureAvatarLoaded(remoteAvatarId, s);
    }

    return s;
  }

  private updateRemotePlayer(sprite: Phaser.GameObjects.Sprite, p: RemotePlayer) {
    const s = sprite as RemoteSprite;
    const prevX = s.prevX ?? p.x;
    const prevY = s.prevY ?? p.y;
    const prevDirection = s.prevDirection ?? p.direction;

    const deltaX = p.x - prevX;
    const deltaY = p.y - prevY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const isMoving = distance > 0.5;
    const directionChanged = prevDirection !== p.direction;

    s.setPosition(p.x, p.y);
    s.prevX = p.x;
    s.prevY = p.y;
    s.prevDirection = p.direction;
    this.applyDepth(s);

    if (p.dnd !== undefined) {
      s.setAlpha(p.dnd ? 0.35 : 1);
    }

    // Check if avatar changed
    const currentAvatarId = s.avatarId ?? avatarRegistry.getDefaultAvatarId();
    const newAvatarId = p.avatarId || currentAvatarId;
    if (newAvatarId !== currentAvatarId) {
      const newTextureKey = avatarRegistry.getTextureKey(newAvatarId);
      if (this.scene.textures.exists(newTextureKey)) {
        s.avatarId = newAvatarId;
        avatarRegistry.createAnimations(this.scene.anims, newAvatarId);
        // Immediately apply the new avatar's idle texture
        const dir = s.prevDirection || p.direction || 'down';
        const { texture, frame } = avatarRegistry.getIdleFrame(newAvatarId, dir);
        s.setTexture(texture, frame);
        s.isStanding = false; // Reset to allow animation system to take over
      } else {
        this.ensureAvatarLoaded(newAvatarId, s);
      }
    }

    this.updateAnimation(s, p.direction, isMoving, directionChanged);
  }

  private ensureAvatarLoaded(avatarId: string, sprite: Phaser.GameObjects.Sprite): void {
    const textureKey = avatarRegistry.getTextureKey(avatarId);

    // Already loaded or currently loading - skip
    if (this.scene.textures.exists(textureKey) || this.loadingAvatars.has(textureKey)) {
      return;
    }

    // Custom avatars (Phase 2 editor) carry no locally known manifest until it
    // is resolved. preloadAvatar no-ops without a manifest, so resolve it first
    // (deduped, with an in-flight + negative cache) and re-enter this method
    // once it arrives — driven by the resolve promise, not the sync tick, so an
    // idle remote still loads. Crucially we do NOT add to loadingAvatars here,
    // or the guard above would wedge the sprite on the default forever.
    if (!avatarRegistry.getManifest(avatarId)) {
      void avatarRegistry.ensureManifest(avatarId).then((manifest) => {
        if (manifest && sprite.active) this.ensureAvatarLoaded(avatarId, sprite);
      });
      return;
    }

    this.loadingAvatars.add(textureKey);
    avatarRegistry.preloadAvatar(this.scene, avatarId);

    // Use per-texture callback to handle simultaneous loads correctly
    this.scene.load.once(`filecomplete-spritesheet-${textureKey}`, () => {
      this.loadingAvatars.delete(textureKey);

      // Sprite may have been destroyed if the player disconnected during loading
      if (!sprite.active) return;

      const s = sprite as RemoteSprite;
      avatarRegistry.createAnimations(this.scene.anims, avatarId);
      s.avatarId = avatarId;

      // Update the sprite to use the newly loaded texture
      const direction = s.prevDirection || 'down';
      const { texture, frame } = avatarRegistry.getIdleFrame(avatarId, direction);
      s.setTexture(texture, frame);
    });

    this.scene.load.start();
  }

  private updateAnimation(
    sprite: Phaser.GameObjects.Sprite,
    direction: string,
    isMoving: boolean,
    directionChanged: boolean,
  ) {
    const s = sprite as RemoteSprite;
    const spriteAvatarId = s.avatarId ?? avatarRegistry.getDefaultAvatarId();
    const animKey = avatarRegistry.getAnimationKey(spriteAvatarId, 'walk', direction);
    const { texture: standingTexture, frame: standingFrame } = avatarRegistry.getIdleFrame(spriteAvatarId, direction);

    if (isMoving) {
      s.lastMoveTime = Date.now();
      s.isStanding = false;

      if (!s.anims.isPlaying || s.anims.currentAnim?.key !== animKey) {
        s.play(animKey, true);
      }
    } else {
      const timeSinceLastMove = Date.now() - (s.lastMoveTime ?? 0);

      if (timeSinceLastMove >= 100) {
        if (!s.isStanding) {
          s.anims.stop();
          s.setTexture(standingTexture, standingFrame);
          s.isStanding = true;
        } else if (directionChanged) {
          s.setTexture(standingTexture, standingFrame);
        }
      }
    }
  }

  private cleanupMissingPlayers(activePlayerIds: string[]) {
    const activeSet = new Set(activePlayerIds);
    for (const id of Array.from(this.remotes.keys())) {
      if (!activeSet.has(id)) {
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);
      }
    }
  }

  // Y-sort a remote by its foot line (center origin). Guarded so a still remote
  // does not re-sort the display list every frame (C3a).
  private applyDepth(s: RemoteSprite): void {
    const depth = actorFootDepth(s.y, s.displayHeight);
    if (depth !== s.lastDepth) {
      s.setDepth(depth);
      s.lastDepth = depth;
    }
  }

  update() {
    for (const [_id, sprite] of this.remotes) {
      if (!sprite.active) continue;
      const s = sprite as RemoteSprite;
      this.applyDepth(s);
      const timeSinceLastMove = Date.now() - (s.lastMoveTime ?? 0);
      if (timeSinceLastMove >= 100 && !s.isStanding) {
        const spriteAvatarId = s.avatarId ?? avatarRegistry.getDefaultAvatarId();
        const direction = s.prevDirection || 'down';
        const { texture, frame } = avatarRegistry.getIdleFrame(spriteAvatarId, direction);
        s.anims.stop();
        s.setTexture(texture, frame);
        s.isStanding = true;
      }
    }
  }

  getRemoteSprite(id: string): Phaser.GameObjects.Sprite | undefined {
    return this.remotes.get(id);
  }

  getAllRemotes(): Map<string, Phaser.GameObjects.Sprite> {
    return this.remotes;
  }

  setVisibility(visible: boolean) {
    this.remotes.forEach((sprite) => sprite.setVisible(visible));
  }

  destroy() {
    this.remotes.forEach((sprite) => sprite.destroy());
    this.remotes.clear();
  }
}
