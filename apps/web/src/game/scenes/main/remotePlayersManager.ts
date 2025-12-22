import Phaser from 'phaser';

export interface RemotePlayer {
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  prevX?: number;
  prevY?: number;
  name?: string;
  dnd?: boolean;
}

export class RemotePlayersManager {
  private scene: Phaser.Scene;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();

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
    const s = this.scene.add.sprite(p.x, p.y, 'hero_walk_down', 0);
    s.setDepth(10);

    (s as any).prevX = p.x;
    (s as any).prevY = p.y;
    (s as any).prevDirection = p.direction;
    (s as any).lastMoveTime = Date.now();

    this.remotes.set(id, s);
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

    this.updateAnimation(s, p.direction, isMoving, directionChanged);
  }

  private updateAnimation(
    s: Phaser.GameObjects.Sprite,
    direction: string,
    isMoving: boolean,
    directionChanged: boolean
  ) {
    const animationMap: Record<string, string> = {
      'up': 'walk_up',
      'down': 'walk_down',
      'left': 'walk_left',
      'right': 'walk_right'
    };

    const textureMap: Record<string, string> = {
      'up': 'hero_walk_up',
      'down': 'hero_walk_down',
      'left': 'hero_walk_left',
      'right': 'hero_walk_right'
    };

    const animKey = animationMap[direction] || 'walk_down';
    const standingTexture = textureMap[direction] || 'hero_walk_down';

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
          s.setTexture(standingTexture, 0);
          (s as any).isStanding = true;
        } else if (directionChanged) {
          s.setTexture(standingTexture, 0);
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
