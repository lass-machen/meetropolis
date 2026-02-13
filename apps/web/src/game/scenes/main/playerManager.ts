import Phaser from 'phaser';
import { logger } from '../../../lib/logger';
import { avatarRegistry } from '../../avatarRegistry';

export interface PlayerManagerConfig {
  scene: Phaser.Scene;
  physics: Phaser.Physics.Arcade.ArcadePhysics;
  anims: Phaser.Animations.AnimationManager;
  mapRef: Phaser.Tilemaps.Tilemap;
  initialPos: { x: number; y: number };
  avatarId?: string;
}

export class PlayerManager {
  private scene: Phaser.Scene;
  private physics: Phaser.Physics.Arcade.ArcadePhysics;
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private desiredPos: { x: number; y: number } | null = null;
  private movementLocked = false;
  private currentDirection: 'up' | 'down' | 'left' | 'right' = 'down';
  private lastReportedX = 0;
  private lastReportedY = 0;
  private lastReportedDirection = 'down';
  private mapRef: Phaser.Tilemaps.Tilemap;
  private avatarId: string;

  constructor(config: PlayerManagerConfig) {
    this.scene = config.scene;
    this.physics = config.physics;
    this.mapRef = config.mapRef;
    this.avatarId = config.avatarId || avatarRegistry.getDefaultAvatarId();

    this.createAnimations(config.anims);
    this.createHero(config.initialPos);
  }

  private createAnimations(anims: Phaser.Animations.AnimationManager) {
    avatarRegistry.createAnimations(anims, this.avatarId);
  }

  private createHero(initialPos: { x: number; y: number }) {
    logger.debug('[PlayerManager] Spawning hero at:', JSON.stringify(initialPos));

    const { texture, frame } = avatarRegistry.getIdleFrame(this.avatarId, 'down');
    this.hero = this.physics.add.sprite(initialPos.x, initialPos.y, texture, frame);

    try {
      this.hero.setCollideWorldBounds(true);
      this.hero.body.setSize(this.mapRef.tileWidth * 0.8, this.mapRef.tileHeight * 0.9);
      const frameHeight = avatarRegistry.getManifest(this.avatarId)?.frameHeight ?? 24;
      (this.hero.body as Phaser.Physics.Arcade.Body).offset.set(
        this.mapRef.tileWidth * 0.1,
        frameHeight - this.mapRef.tileHeight * 0.9  // Align physics body with avatar feet (bottom of sprite frame)
      );
    } catch { }

    this.hero.setDepth(10);

    this.lastReportedX = this.hero.x;
    this.lastReportedY = this.hero.y;
  }

  getHero(): Phaser.Types.Physics.Arcade.SpriteWithDynamicBody {
    return this.hero;
  }

  setDesiredPosition(pos: { x: number; y: number } | null) {
    const prev = this.desiredPos;
    const same = (prev === null && pos === null) ||
                 (prev && pos && prev.x === pos.x && prev.y === pos.y);
    if (same) return;

    this.desiredPos = pos;
    try { logger.debug('[PlayerManager] desiredPos set to', pos); } catch { }
  }

  setMovementLocked(locked: boolean) {
    this.movementLocked = !!locked;
    if (locked) {
      this.desiredPos = null;
      try { this.hero?.body?.setVelocity?.(0, 0); } catch { }
      try { this.hero?.anims?.stop?.(); } catch { }
    }
  }

  setTransparency(alpha: number) {
    if (this.hero) this.hero.setAlpha(alpha);
  }

  update(cursors: Phaser.Types.Input.Keyboard.CursorKeys, onMove?: (data: { x: number; y: number; direction: string }) => void) {
    const speed = 80;
    const body = this.hero.body;
    body.setVelocity(0);

    if (this.desiredPos) {
      this.updateDesiredMovement(speed);
    } else if (!this.movementLocked) {
      this.updateKeyboardMovement(cursors, speed);
    } else {
      this.stopMovement();
    }

    this.reportMovement(onMove);
  }

  private updateDesiredMovement(speed: number) {
    if (!this.desiredPos) return;

    const dx = this.desiredPos.x - this.hero.x;
    const dy = this.desiredPos.y - this.hero.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 < 2) {
      this.desiredPos = null;
      this.hero.anims.stop();
    } else {
      const nx = dx / Math.max(Math.hypot(dx, dy), 1e-6);
      const ny = dy / Math.max(Math.hypot(dx, dy), 1e-6);
      this.hero.body.setVelocity(nx * speed, ny * speed);

      if (Math.abs(nx) > Math.abs(ny)) {
        const dir = nx > 0 ? 'right' : 'left';
        this.currentDirection = dir;
        this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', dir), true);
      } else {
        const dir = ny > 0 ? 'down' : 'up';
        this.currentDirection = dir;
        this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', dir), true);
      }
    }
  }

  private updateKeyboardMovement(cursors: Phaser.Types.Input.Keyboard.CursorKeys, speed: number) {
    const body = this.hero.body;

    if (cursors.left?.isDown) {
      body.setVelocityX(-speed);
      this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', 'left'), true);
      this.currentDirection = 'left';
    } else if (cursors.right?.isDown) {
      body.setVelocityX(speed);
      this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', 'right'), true);
      this.currentDirection = 'right';
    } else if (cursors.up?.isDown) {
      body.setVelocityY(-speed);
      this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', 'up'), true);
      this.currentDirection = 'up';
    } else if (cursors.down?.isDown) {
      body.setVelocityY(speed);
      this.hero.play(avatarRegistry.getAnimationKey(this.avatarId, 'walk', 'down'), true);
      this.currentDirection = 'down';
    } else {
      this.stopMovement();
    }
  }

  private stopMovement() {
    this.hero.body.setVelocity(0, 0);
    this.hero.anims.stop();
    const { texture, frame } = avatarRegistry.getIdleFrame(this.avatarId, this.currentDirection);
    this.hero.setTexture(texture, frame);
  }

  private reportMovement(onMove?: (data: { x: number; y: number; direction: string }) => void) {
    const positionChanged = Math.abs(this.hero.x - this.lastReportedX) > 0.5 ||
                           Math.abs(this.hero.y - this.lastReportedY) > 0.5;
    const directionChanged = this.currentDirection !== this.lastReportedDirection;

    if ((positionChanged || directionChanged) && onMove) {
      this.lastReportedX = this.hero.x;
      this.lastReportedY = this.hero.y;
      this.lastReportedDirection = this.currentDirection;
      onMove({ x: this.hero.x, y: this.hero.y, direction: this.currentDirection });
    }
  }

  getCurrentDirection(): string {
    return this.currentDirection;
  }

  changeAvatar(avatarId: string) {
    this.avatarId = avatarId;
    this.createAnimations(this.scene.anims);
    const { texture, frame } = avatarRegistry.getIdleFrame(avatarId, this.currentDirection);
    this.hero.setTexture(texture, frame);
  }
}
