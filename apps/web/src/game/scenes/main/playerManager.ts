import Phaser from 'phaser';
import { logger } from '../../../lib/logger';

export interface PlayerManagerConfig {
  scene: Phaser.Scene;
  physics: Phaser.Physics.Arcade.ArcadePhysics;
  anims: Phaser.Animations.AnimationManager;
  mapRef: Phaser.Tilemaps.Tilemap;
  initialPos: { x: number; y: number };
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

  constructor(config: PlayerManagerConfig) {
    this.scene = config.scene;
    this.physics = config.physics;
    this.mapRef = config.mapRef;

    this.createAnimations(config.anims);
    this.createHero(config.initialPos);
  }

  private createAnimations(anims: Phaser.Animations.AnimationManager) {
    anims.create({
      key: 'walk_down',
      frames: anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
    anims.create({
      key: 'walk_up',
      frames: anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
    anims.create({
      key: 'walk_left',
      frames: anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
    anims.create({
      key: 'walk_right',
      frames: anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
  }

  private createHero(initialPos: { x: number; y: number }) {
    logger.debug('[PlayerManager] Spawning hero at:', JSON.stringify(initialPos));

    this.hero = this.physics.add.sprite(initialPos.x, initialPos.y, 'hero_walk_down', 0);

    try {
      this.hero.setCollideWorldBounds(true);
      this.hero.body.setSize(this.mapRef.tileWidth * 0.8, this.mapRef.tileHeight * 0.9);
      (this.hero.body as Phaser.Physics.Arcade.Body).offset.set(
        this.mapRef.tileWidth * 0.1,
        this.mapRef.tileHeight * 0.1
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
        this.currentDirection = nx > 0 ? 'right' : 'left';
        this.hero.play(nx > 0 ? 'walk_right' : 'walk_left', true);
      } else {
        this.currentDirection = ny > 0 ? 'down' : 'up';
        this.hero.play(ny > 0 ? 'walk_down' : 'walk_up', true);
      }
    }
  }

  private updateKeyboardMovement(cursors: Phaser.Types.Input.Keyboard.CursorKeys, speed: number) {
    const body = this.hero.body;

    if (cursors.left?.isDown) {
      body.setVelocityX(-speed);
      this.hero.play('walk_left', true);
      this.currentDirection = 'left';
    } else if (cursors.right?.isDown) {
      body.setVelocityX(speed);
      this.hero.play('walk_right', true);
      this.currentDirection = 'right';
    } else if (cursors.up?.isDown) {
      body.setVelocityY(-speed);
      this.hero.play('walk_up', true);
      this.currentDirection = 'up';
    } else if (cursors.down?.isDown) {
      body.setVelocityY(speed);
      this.hero.play('walk_down', true);
      this.currentDirection = 'down';
    } else {
      this.stopMovement();
    }
  }

  private stopMovement() {
    this.hero.body.setVelocity(0, 0);
    this.hero.anims.stop();

    const base: any = {
      up: 'hero_walk_up',
      down: 'hero_walk_down',
      left: 'hero_walk_left',
      right: 'hero_walk_right'
    };
    this.hero.setTexture(base[this.currentDirection] || 'hero_walk_down', 0);
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
}
