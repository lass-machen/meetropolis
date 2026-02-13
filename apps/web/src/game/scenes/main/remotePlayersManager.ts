import Phaser from 'phaser';
import { avatarRegistry } from '../../avatarRegistry';

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
    const s = this.scene.add.sprite(p.x, p.y, texture, frame);
    s.setDepth(10);

    (s as any).prevX = p.x;
    (s as any).prevY = p.y;
    (s as any).prevDirection = p.direction;
    (s as any).lastMoveTime = Date.now();
    (s as any).avatarId = initialAvatarId;

    this.remotes.set(id, s);

    // If the desired avatar wasn't loaded, start loading it asynchronously
    if (!textureReady) {
      this.ensureAvatarLoaded(remoteAvatarId, s);
    }

    return s;
  }

  private updateRemotePlayer(s: Phaser.GameObjects.Sprite, p: RemotePlayer) {
    const prevX = (s as any).prevX || p.x;
    const prevY = (s as any).prevY || p.y;
    const prevDirection = (s as any).prevDirection || p.direction;

    const deltaX = p.x - prevX;
    const deltaY = p.y - prevY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const isMoving = distance > 0.5;
    const directionChanged = prevDirection !== p.direction;

    s.setPosition(p.x, p.y);
    (s as any).prevX = p.x;
    (s as any).prevY = p.y;
    (s as any).prevDirection = p.direction;

    if (p.dnd !== undefined) {
      s.setAlpha(p.dnd ? 0.35 : 1);
    }

    // Check if avatar changed
    const currentAvatarId = (s as any).avatarId || avatarRegistry.getDefaultAvatarId();
    const newAvatarId = p.avatarId || currentAvatarId;
    if (newAvatarId !== currentAvatarId) {
      const newTextureKey = avatarRegistry.getTextureKey(newAvatarId);
      if (this.scene.textures.exists(newTextureKey)) {
        (s as any).avatarId = newAvatarId;
        avatarRegistry.createAnimations(this.scene.anims, newAvatarId);
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

    this.loadingAvatars.add(textureKey);
    avatarRegistry.preloadAvatar(this.scene, avatarId);

    // Use per-texture callback to handle simultaneous loads correctly
    this.scene.load.once(`filecomplete-spritesheet-${textureKey}`, () => {
      this.loadingAvatars.delete(textureKey);

      // Sprite may have been destroyed if the player disconnected during loading
      if (!sprite.active) return;

      avatarRegistry.createAnimations(this.scene.anims, avatarId);
      (sprite as any).avatarId = avatarId;

      // Update the sprite to use the newly loaded texture
      const direction = (sprite as any).prevDirection || 'down';
      const { texture, frame } = avatarRegistry.getIdleFrame(avatarId, direction);
      sprite.setTexture(texture, frame);
    });

    this.scene.load.start();
  }

  private updateAnimation(
    s: Phaser.GameObjects.Sprite,
    direction: string,
    isMoving: boolean,
    directionChanged: boolean
  ) {
    const spriteAvatarId = (s as any).avatarId || avatarRegistry.getDefaultAvatarId();
    const animKey = avatarRegistry.getAnimationKey(spriteAvatarId, 'walk', direction);
    const { texture: standingTexture, frame: standingFrame } = avatarRegistry.getIdleFrame(spriteAvatarId, direction);

    if (isMoving) {
      (s as any).lastMoveTime = Date.now();
      (s as any).isStanding = false;

      if (!s.anims.isPlaying || s.anims.currentAnim?.key !== animKey) {
        s.play(animKey, true);
      }
    } else {
      const timeSinceLastMove = Date.now() - ((s as any).lastMoveTime || 0);

      if (timeSinceLastMove >= 100) {
        if (!(s as any).isStanding) {
          s.anims.stop();
          s.setTexture(standingTexture, standingFrame);
          (s as any).isStanding = true;
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
