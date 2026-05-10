import Phaser from 'phaser';
import { EditorService } from '../../../services/EditorService';

export interface UIManagerConfig {
  scene: Phaser.Scene;
  getEditorMode: () => boolean;
}

export class UIManager {
  private scene: Phaser.Scene;
  private getEditorMode: () => boolean;
  private zoneG?: Phaser.GameObjects.Graphics;
  private zonesVisible: boolean = true;
  private spawnG?: Phaser.GameObjects.Graphics;
  private hoverOutline?: Phaser.GameObjects.Graphics;
  private hoveredSprite: Phaser.GameObjects.Sprite | null = null;

  constructor(config: UIManagerConfig) {
    this.scene = config.scene;
    this.getEditorMode = config.getEditorMode;
  }

  init() {
    this.hoverOutline = this.scene.add.graphics();
    this.hoverOutline.setDepth(11);
  }

  setHoveredSprite(sprite: Phaser.GameObjects.Sprite | null) {
    this.hoveredSprite = sprite;
    this.updateHoverOutline();
  }

  getHoveredSprite(): Phaser.GameObjects.Sprite | null {
    return this.hoveredSprite;
  }

  updateCursor(isPanning: boolean, isSpaceHeld: boolean) {
    try {
      const input = this.scene.input;
      if (!input) return;
      let cursor: string = 'default';

      if (this.getEditorMode()) {
        const state = EditorService.getState();
        if (state.tool === 'spawn') cursor = 'crosshair';
      }

      if (isPanning) {
        cursor = 'grabbing';
      } else if (isSpaceHeld) {
        cursor = 'grab';
      } else if (this.hoveredSprite) {
        cursor = 'pointer';
      }
      input.setDefaultCursor(cursor);
    } catch {}
  }

  private updateHoverOutline() {
    if (!this.hoverOutline) return;
    this.hoverOutline.clear();

    if (this.hoveredSprite) {
      const bounds = this.hoveredSprite.getBounds();
      this.hoverOutline.lineStyle(2, 0x00ff00, 1);
      this.hoverOutline.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
      this.hoverOutline.lineStyle(4, 0x00ff00, 0.3);
      this.hoverOutline.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
    }
  }

  setZoneOverlay(polys: { name: string; points: any[] }[]) {
    try {
      if (!this.getEditorMode() || !this.zonesVisible) {
        if (this.zoneG) {
          this.zoneG.clear();
          this.zoneG.setVisible(false);
        }
        return;
      }
      if (!this.zoneG || !this.zoneG.scene) {
        this.zoneG = this.scene.add.graphics();
        this.zoneG.setDepth(8);
      }
      const g = this.zoneG;
      g.setVisible(true);
      g.clear();
      g.lineStyle(2, 0x00ff99, 1);
      g.fillStyle(0x00ff99, 0.18);

      const toPoint = (v: any): { x: number; y: number } | null => {
        if (!v) return null;
        if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
        if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number')
          return { x: v[0], y: v[1] };
        const px = v.x,
          py = v.y;
        if ((typeof px === 'string' || typeof px === 'number') && (typeof py === 'string' || typeof py === 'number')) {
          const nx = Number(px);
          const ny = Number(py);
          if (!Number.isNaN(nx) && !Number.isNaN(ny)) return { x: nx, y: ny };
        }
        return null;
      };

      for (const poly of Array.isArray(polys) ? polys : []) {
        const raw = Array.isArray(poly?.points) ? poly.points : [];
        const pts = raw.map(toPoint).filter((p: any) => p && typeof p.x === 'number' && typeof p.y === 'number') as {
          x: number;
          y: number;
        }[];
        if (!pts || pts.length < 3) continue;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }
    } catch {}
  }

  setZonesVisible(visible: boolean) {
    try {
      this.zonesVisible = !!visible;
      if (!this.zonesVisible && this.zoneG) {
        this.zoneG.clear();
        this.zoneG.setVisible(false);
      }
    } catch {}
  }

  setSpawnMarker(pos: { x: number; y: number } | null) {
    try {
      if (!this.getEditorMode()) {
        if (this.spawnG) {
          this.spawnG.clear();
          this.spawnG.setVisible(false);
        }
        return;
      }
      if (!this.spawnG || !this.spawnG.scene) {
        this.spawnG = this.scene.add.graphics();
        this.spawnG.setDepth(9);
      }
      const g = this.spawnG;
      g.setVisible(true);
      g.clear();
      if (!pos) return;
      const r = 6;
      g.fillStyle(0x9ca3af, 0.35);
      g.fillCircle(pos.x, pos.y, r);
      g.lineStyle(1, 0x9ca3af, 0.9);
      g.beginPath();
      g.moveTo(pos.x - r - 2, pos.y);
      g.lineTo(pos.x + r + 2, pos.y);
      g.moveTo(pos.x, pos.y - r - 2);
      g.lineTo(pos.x, pos.y + r + 2);
      g.strokePath();
    } catch {}
  }

  hideEditorOverlays() {
    try {
      if (this.zoneG) {
        this.zoneG.clear();
        this.zoneG.setVisible(false);
      }
    } catch {}
    try {
      if (this.spawnG) {
        this.spawnG.clear();
        this.spawnG.setVisible(false);
      }
    } catch {}
  }
}
