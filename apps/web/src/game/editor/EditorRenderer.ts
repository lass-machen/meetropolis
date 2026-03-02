/**
 * EditorRenderer - Reine Rendering-Schicht für den Editor
 * 
 * Prinzipien:
 * - Keine Business-Logik
 * - Keine State-Verwaltung
 * - Nur "dumb renderer"
 * - Explizite Fehler
 */

import Phaser from 'phaser';
import { Zone, Asset } from '../../services/EditorService';
import { lookupDirectionalImage } from '../../lib/directionalImageRegistry';

export class EditorRenderer {
  private scene: Phaser.Scene;
  
  // Graphics Objects
  private zonesGraphics: Phaser.GameObjects.Graphics | undefined;
  private spawnGraphics: Phaser.GameObjects.Graphics | undefined;
  private selectionGraphics: Phaser.GameObjects.Graphics | undefined;
  private cursorHighlight: Phaser.GameObjects.Graphics | undefined;
  private ghostSprite: Phaser.GameObjects.Image | undefined;

  // Zone Labels
  private zoneLabels: Phaser.GameObjects.Text[] = [];
  private zoneLabelWorldPositions: { x: number; y: number }[] = [];
  private postUpdateListener: (() => void) | undefined;

  // Asset Sprites
  private assetSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private pendingTextures: Set<string> = new Set();

  // Ghost state
  private ghostTextureKey: string | undefined;
  private lastCursorPos: { x: number; y: number } | null = null;

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 200); i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.initialize();
  }

  private initialize(): void {
    // Zones Graphics
    this.zonesGraphics = this.scene.add.graphics();
    this.zonesGraphics.setDepth(9);

    // Spawn Graphics
    this.spawnGraphics = this.scene.add.graphics();
    this.spawnGraphics.setDepth(9);

    // Selection Graphics
    this.selectionGraphics = this.scene.add.graphics();
    this.selectionGraphics.setDepth(8);

    // Cursor Highlight Graphics
    this.cursorHighlight = this.scene.add.graphics();
    this.cursorHighlight.setDepth(7);

    // Hook POST_UPDATE for zone label position updates
    this.postUpdateListener = () => this.updateZoneLabelPositions();
    this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.postUpdateListener);
  }

  /**
   * Rendert Zonen-Overlays
   */
  public renderZones(zones: Zone[], visible: boolean = true): void {
    if (!this.zonesGraphics) {
      throw new Error('ZonesGraphics not initialized');
    }

    this.zonesGraphics.clear();

    // Destroy old zone labels to prevent memory leak
    this.clearZoneLabels();

    if (!visible || zones.length === 0) {
      return;
    }

    zones.forEach((zone, index) => {
      if (!zone.points || zone.points.length < 3) {
        return;
      }

      const hue = (index * 137.5) % 360;
      const fillColor = Phaser.Display.Color.HSLToColor(hue / 360, 0.6, 0.5).color;
      const strokeColor = Phaser.Display.Color.HSLToColor(hue / 360, 0.8, 0.7).color;

      this.zonesGraphics!.fillStyle(fillColor, 0.15);
      this.zonesGraphics!.lineStyle(2, strokeColor, 0.8);

      this.zonesGraphics!.beginPath();
      this.zonesGraphics!.moveTo(zone.points[0].x, zone.points[0].y);

      for (let i = 1; i < zone.points.length; i++) {
        this.zonesGraphics!.lineTo(zone.points[i].x, zone.points[i].y);
      }

      this.zonesGraphics!.closePath();
      this.zonesGraphics!.fillPath();
      this.zonesGraphics!.strokePath();

      // Zone-Name rendern (in labelLayer for zoom-independent sizing)
      const minX = Math.min(...zone.points.map(p => p.x)) + 5;
      const minY = Math.min(...zone.points.map(p => p.y)) + 5;

      const text = this.scene.add.text(0, 0, zone.name, {
        fontSize: '11px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 3, y: 2 },
      });
      text.setOrigin(0, 0);
      text.setDepth(10);

      // Add to labelLayer if available (zoom-independent rendering)
      const labelLayer = (this.scene as any).labelLayer;
      if (labelLayer) {
        labelLayer.add(text);
      }

      this.zoneLabels.push(text);
      this.zoneLabelWorldPositions.push({ x: minX, y: minY });
    });

    // Immediately update label positions
    this.updateZoneLabelPositions();
  }

  /**
   * Updates zone label positions from world to screen coordinates (for labelLayer/labelCamera)
   */
  private updateZoneLabelPositions(): void {
    if (this.zoneLabels.length === 0) return;

    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    for (let i = 0; i < this.zoneLabels.length; i++) {
      const label = this.zoneLabels[i];
      const worldPos = this.zoneLabelWorldPositions[i];
      if (!label || !worldPos) continue;

      const screenX = (worldPos.x - view.x) * cam.zoom;
      const screenY = (worldPos.y - view.y) * cam.zoom;
      label.setPosition(Math.round(screenX), Math.round(screenY));
    }
  }

  /**
   * Destroys all zone label objects
   */
  private clearZoneLabels(): void {
    for (const label of this.zoneLabels) {
      label.destroy();
    }
    this.zoneLabels = [];
    this.zoneLabelWorldPositions = [];
  }

  /**
   * Rendert Spawn-Marker
   */
  public renderSpawn(spawn: { x: number; y: number } | null): void {
    if (!this.spawnGraphics) {
      throw new Error('SpawnGraphics not initialized');
    }

    this.spawnGraphics.clear();

    if (!spawn) {
      return;
    }

    // Äußerer Kreis
    this.spawnGraphics.lineStyle(3, 0x22c55e, 1);
    this.spawnGraphics.strokeCircle(spawn.x, spawn.y, 12);

    // Innerer Kreis
    this.spawnGraphics.fillStyle(0x22c55e, 0.3);
    this.spawnGraphics.fillCircle(spawn.x, spawn.y, 8);

    // Kreuz
    this.spawnGraphics.lineStyle(2, 0x22c55e, 1);
    this.spawnGraphics.beginPath();
    this.spawnGraphics.moveTo(spawn.x - 6, spawn.y);
    this.spawnGraphics.lineTo(spawn.x + 6, spawn.y);
    this.spawnGraphics.moveTo(spawn.x, spawn.y - 6);
    this.spawnGraphics.lineTo(spawn.x, spawn.y + 6);
    this.spawnGraphics.strokePath();
  }

  /**
   * Rendert Selektion-Rechteck
   */
  public renderSelection(rect: { x: number; y: number; w: number; h: number } | null): void {
    if (!this.selectionGraphics) {
      throw new Error('SelectionGraphics not initialized');
    }

    this.selectionGraphics.clear();

    if (!rect) {
      return;
    }

    this.selectionGraphics.lineStyle(2, 0x3b82f6, 1);
    this.selectionGraphics.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Gestrichelte Ecken für bessere Sichtbarkeit
    this.selectionGraphics.fillStyle(0x3b82f6, 0.1);
    this.selectionGraphics.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  /**
   * Rendert Cursor-Highlight (Tile-Outline bei Hover)
   */
  public renderCursorHighlight(tileX: number, tileY: number, tileSize: number): void {
    if (!this.cursorHighlight) return;
    this.cursorHighlight.clear();
    this.cursorHighlight.lineStyle(1, 0xffffff, 0.4);
    this.cursorHighlight.strokeRect(tileX * tileSize, tileY * tileSize, tileSize, tileSize);
  }

  /**
   * Entfernt Cursor-Highlight
   */
  public clearCursorHighlight(): void {
    this.cursorHighlight?.clear();
  }

  /**
   * Rendert Ghost-Sprite (Preview für Asset-Tool)
   */
  public renderGhost(preview: {
    dataUrl: string;
    width?: number | undefined;
    height?: number | undefined;
    rotation?: number | undefined;
    packUuid?: string | undefined;
    itemId?: string | undefined;
    scaleFactor?: number | undefined;
  } | null): void {
    if (!preview) {
      this.clearGhost();
      return;
    }

    const rotation = preview.rotation ?? 0;
    let useDirectionalImage = false;
    let resolvedUrl = preview.dataUrl;
    if (preview.packUuid && preview.itemId) {
      const dirUrl = lookupDirectionalImage(preview.packUuid, preview.itemId, rotation);
      if (dirUrl) {
        resolvedUrl = dirUrl;
        useDirectionalImage = true;
      }
    }

    const newKey = (preview.packUuid && preview.itemId)
      ? `ghost_${preview.packUuid}_${preview.itemId}_${rotation}`
      : `ghost_${this.hashString(resolvedUrl)}_${rotation}`;

    // If key matches current ghost, just update properties without reloading texture
    if (this.ghostTextureKey === newKey && this.ghostSprite) {
      this.ghostSprite.setVisible(true);
      if (useDirectionalImage) {
        this.ghostSprite.setRotation(0);
      } else {
        this.ghostSprite.setRotation(Phaser.Math.DegToRad(rotation));
      }
      this.ghostSprite.setScale(preview.scaleFactor ?? 1);
      return;
    }

    const place = () => {
      if (!this.ghostSprite) {
        const img = this.scene.add.image(0, 0, newKey);
        img.setAlpha(0.6);
        img.setDepth(6.5);
        this.ghostSprite = img;
      } else {
        this.ghostSprite.setTexture(newKey);
      }

      this.ghostSprite.setVisible(true);

      // Directional image = no rotation, else programmatic rotation
      if (useDirectionalImage) {
        this.ghostSprite.setRotation(0);
      } else {
        this.ghostSprite.setRotation(Phaser.Math.DegToRad(rotation));
      }

      this.ghostSprite.setScale(preview.scaleFactor ?? 1);

      // Position auf letzte Cursor-Position oder Kamera-Center als Fallback
      if (this.lastCursorPos) {
        this.ghostSprite.setPosition(this.lastCursorPos.x, this.lastCursorPos.y);
      } else {
        const cam = this.scene.cameras.main;
        this.ghostSprite.setPosition(cam.worldView.centerX, cam.worldView.centerY);
      }

      // Alte Texture aufräumen
      if (this.ghostTextureKey && this.ghostTextureKey !== newKey) {
        if (this.scene.textures.exists(this.ghostTextureKey)) {
          this.scene.textures.remove(this.ghostTextureKey);
        }
      }

      this.ghostTextureKey = newKey;
    };

    if (this.scene.textures.exists(newKey)) {
      place();
    } else {
      const handler = (key: string) => {
        if (key === newKey) {
          this.scene.textures.off('addtexture', handler);
          place();
        }
      };
      this.scene.textures.on('addtexture', handler);

      if (resolvedUrl.startsWith('data:')) {
        this.scene.textures.addBase64(newKey, resolvedUrl);
      } else {
        this.scene.load.image(newKey, resolvedUrl);
        this.scene.load.start();
      }
    }
  }

  /**
   * Entfernt Ghost-Sprite
   */
  private clearGhost(): void {
    if (this.ghostSprite) {
      this.ghostSprite.destroy();
      this.ghostSprite = undefined;
    }

    if (this.ghostTextureKey && this.scene.textures.exists(this.ghostTextureKey)) {
      this.scene.textures.remove(this.ghostTextureKey);
    }

    this.ghostTextureKey = undefined;
  }

  /**
   * Rendert Assets
   */
  public renderAssets(assets: Asset[]): void {
    // Entferne nicht mehr existierende Assets
    const assetIds = new Set(assets.map(a => a.id));
    for (const [id, sprite] of this.assetSprites) {
      if (!assetIds.has(id)) {
        sprite.destroy();
        this.assetSprites.delete(id);
      }
    }

    // Rendere/Update Assets
    for (const asset of assets) {
      const rotation = asset.rotation ?? 0;
      let useDirectionalImage = false;
      let resolvedUrl = asset.dataUrl;

      if (asset.packUuid && asset.itemId) {
        const dirUrl = lookupDirectionalImage(asset.packUuid, asset.itemId, rotation);
        if (dirUrl) {
          resolvedUrl = dirUrl;
          useDirectionalImage = true;
        }
      }

      const textureKey = useDirectionalImage
        ? `asset_${asset.id}_dir${rotation}`
        : `asset_${asset.id}`;
      let sprite = this.assetSprites.get(asset.id);

      if (!sprite) {
        // Sprite muss erstellt werden
        if (!this.scene.textures.exists(textureKey) && !this.pendingTextures.has(textureKey)) {
          this.pendingTextures.add(textureKey);

          const assetHandler = (key: string) => {
            if (key === textureKey) {
              this.scene.textures.off('addtexture', assetHandler);
              this.pendingTextures.delete(textureKey);

              const newSprite = this.scene.add.image(asset.x, asset.y, textureKey);
              newSprite.setOrigin(0, 0);
              newSprite.setDepth(6);
              newSprite.setInteractive();
              if (!useDirectionalImage && rotation) {
                newSprite.setRotation(Phaser.Math.DegToRad(rotation));
              }
              newSprite.setScale(asset.scaleFactor ?? 1);
              this.assetSprites.set(asset.id, newSprite);
            }
          };
          this.scene.textures.on('addtexture', assetHandler);

          if (resolvedUrl.startsWith('data:')) {
            this.scene.textures.addBase64(textureKey, resolvedUrl);
          } else {
            this.scene.load.image(textureKey, resolvedUrl);
            this.scene.load.start();
          }
        } else if (this.scene.textures.exists(textureKey)) {
          sprite = this.scene.add.image(asset.x, asset.y, textureKey);
          sprite.setOrigin(0, 0);
          sprite.setDepth(6);
          sprite.setInteractive();
          if (!useDirectionalImage && rotation) {
            sprite.setRotation(Phaser.Math.DegToRad(rotation));
          }
          sprite.setScale(asset.scaleFactor ?? 1);
          this.assetSprites.set(asset.id, sprite);
        }
      } else {
        // Sprite existiert, Position updaten
        sprite.setPosition(asset.x, asset.y);
        if (useDirectionalImage) {
          sprite.setRotation(0);
        } else if (rotation) {
          sprite.setRotation(Phaser.Math.DegToRad(rotation));
        }
        sprite.setScale(asset.scaleFactor ?? 1);
      }
    }
  }

  /**
   * Update Ghost-Position (wird bei Pointer-Move aufgerufen)
   */
  public updateGhostPosition(x: number, y: number): void {
    this.lastCursorPos = { x, y };
    if (this.ghostSprite) {
      this.ghostSprite.setPosition(x, y);
    }
  }

  /**
   * Räumt alle Renderer-Objekte auf
   */
  public clearAll(): void {
    this.zonesGraphics?.clear();
    this.spawnGraphics?.clear();
    this.selectionGraphics?.clear();
    this.cursorHighlight?.clear();
    this.clearGhost();
    this.clearZoneLabels();

    for (const sprite of this.assetSprites.values()) {
      sprite.destroy();
    }
    this.assetSprites.clear();
  }

  /**
   * Zerstört den Renderer und gibt Ressourcen frei
   */
  public destroy(): void {
    // Remove POST_UPDATE listener
    if (this.postUpdateListener) {
      this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.postUpdateListener);
      this.postUpdateListener = undefined;
    }

    this.clearAll();

    this.zonesGraphics?.destroy();
    this.spawnGraphics?.destroy();
    this.selectionGraphics?.destroy();
    this.cursorHighlight?.destroy();

    this.zonesGraphics = undefined;
    this.spawnGraphics = undefined;
    this.selectionGraphics = undefined;
    this.cursorHighlight = undefined;
  }
}

