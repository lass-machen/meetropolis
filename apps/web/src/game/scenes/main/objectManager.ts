import Phaser from 'phaser';
import { baseUrl } from '../../../lib/mapV2';
import { logger } from '../../../lib/logger';
import { lookupDirectionalImage } from '../../../lib/directionalImageRegistry';

export interface MapObjectData {
  id: number;
  mapId: string;
  assetPackUuid: string;
  itemId: string;
  category: string;
  tileX: number;
  tileY: number;
  chunkX: number;
  chunkY: number;
  width: number;
  height: number;
  collide: boolean;
  zIndex: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  scaleFactor: number;
  dataUrl: string;
}

export interface ObjectsUpdatedPayload {
  action: 'add' | 'remove' | 'update';
  objects?: MapObjectData[] | undefined;
  objectIds?: number[] | undefined;
}

export interface ObjectManagerConfig {
  scene: Phaser.Scene & { mapRef?: Phaser.Tilemaps.Tilemap; currentMapId: string; v2?: { chunkSize: number } };
}

export class ObjectManager {
  private scene: ObjectManagerConfig['scene'];
  private sprites: Map<number, Phaser.GameObjects.Image> = new Map();
  private loadedChunks: Set<string> = new Set();
  private loadingChunks: Set<string> = new Set();
  private pendingTextureLoads: Map<string, Array<() => void>> = new Map();
  private spritesVisible = true;

  constructor(config: ObjectManagerConfig) {
    this.scene = config.scene;
  }

  async loadVisibleChunks(camera: Phaser.Cameras.Scene2D.Camera): Promise<void> {
    const tileW = this.scene.mapRef?.tileWidth ?? 16;
    const tileH = this.scene.mapRef?.tileHeight ?? 16;
    const cs = this.scene.v2?.chunkSize ?? 32;

    const x0 = Math.max(0, Math.floor(camera.worldView.x / tileW));
    const y0 = Math.max(0, Math.floor(camera.worldView.y / tileH));
    const mapW = this.scene.mapRef?.width ?? 9999;
    const mapH = this.scene.mapRef?.height ?? 9999;
    const x1 = Math.min(mapW - 1, Math.floor((camera.worldView.x + camera.worldView.width) / tileW));
    const y1 = Math.min(mapH - 1, Math.floor((camera.worldView.y + camera.worldView.height) / tileH));

    const cx0 = Math.floor(x0 / cs);
    const cy0 = Math.floor(y0 / cs);
    const cx1 = Math.floor(x1 / cs);
    const cy1 = Math.floor(y1 / cs);

    const keys: string[] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = `${cx}:${cy}`;
        if (!this.loadedChunks.has(k) && !this.loadingChunks.has(k)) keys.push(k);
      }
    }
    if (keys.length === 0) return;

    keys.forEach(k => this.loadingChunks.add(k));

    try {
      const objects = await this.fetchObjectsByChunks(keys);
      keys.forEach(k => {
        this.loadedChunks.add(k);
        this.loadingChunks.delete(k);
      });
      for (const obj of objects) {
        if (!this.sprites.has(obj.id)) this.addObject(obj);
      }
    } catch (e) {
      keys.forEach(k => this.loadingChunks.delete(k));
      logger.warn('[ObjectManager] Failed to load object chunks', e);
    }
  }

  addObject(obj: MapObjectData): void {
    if (this.sprites.has(obj.id)) {
      this.updateObject(obj);
      return;
    }

    // Check for directional image override
    const dirUrl = lookupDirectionalImage(obj.assetPackUuid, obj.itemId, obj.rotation);
    const useDirectionalImage = !!dirUrl;
    const resolvedUrl = dirUrl ?? obj.dataUrl;
    const textureKey = useDirectionalImage
      ? `mapobj_${obj.id}_dir${obj.rotation}`
      : `mapobj_${obj.id}`;

    if (this.scene.textures.exists(textureKey)) {
      this.createSprite(obj, textureKey, useDirectionalImage);
    } else {
      this.loadTexture(textureKey, resolvedUrl, () => this.createSprite(obj, textureKey, useDirectionalImage));
    }
  }

  removeObject(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  updateObject(obj: MapObjectData): void {
    const sprite = this.sprites.get(obj.id);
    if (!sprite) {
      this.addObject(obj);
      return;
    }
    const tileW = this.scene.mapRef?.tileWidth ?? 16;
    const tileH = this.scene.mapRef?.tileHeight ?? 16;
    sprite.setPosition(obj.tileX * tileW, obj.tileY * tileH);
    sprite.setOrigin(0, 0);

    // Check for directional image on rotation change
    const dirUrl = lookupDirectionalImage(obj.assetPackUuid, obj.itemId, obj.rotation);
    if (dirUrl) {
      const dirKey = `mapobj_${obj.id}_dir${obj.rotation}`;
      if (this.scene.textures.exists(dirKey)) {
        sprite.setTexture(dirKey);
        sprite.setRotation(0);
      } else {
        this.loadTexture(dirKey, dirUrl, () => {
          if (this.sprites.has(obj.id)) {
            sprite.setTexture(dirKey);
            sprite.setRotation(0);
          }
        });
      }
    } else {
      sprite.setRotation(Phaser.Math.DegToRad(obj.rotation));
    }

    sprite.setFlip(obj.flipX, obj.flipY);
    sprite.setDepth(obj.zIndex);
    const sf = obj.scaleFactor ?? 1;
    if (sf !== 1) sprite.setScale(sf);
  }

  handleObjectsUpdated(payload: ObjectsUpdatedPayload): void {
    switch (payload.action) {
      case 'add':
        if (Array.isArray(payload.objects)) {
          for (const obj of payload.objects) this.addObject(obj);
        }
        break;
      case 'remove':
        if (Array.isArray(payload.objectIds)) {
          for (const id of payload.objectIds) this.removeObject(id);
        }
        break;
      case 'update':
        if (Array.isArray(payload.objects)) {
          for (const obj of payload.objects) this.updateObject(obj);
        }
        break;
    }
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.loadedChunks.clear();
    this.loadingChunks.clear();
    this.pendingTextureLoads.clear();
  }

  setAllSpritesVisible(visible: boolean): void {
    this.spritesVisible = visible;
    for (const sprite of this.sprites.values()) {
      sprite.setVisible(visible);
    }
  }

  private createSprite(obj: MapObjectData, textureKey: string, useDirectionalImage = false): void {
    if (this.sprites.has(obj.id)) return;
    if (!this.scene.textures.exists(textureKey)) return;

    const tileW = this.scene.mapRef?.tileWidth ?? 16;
    const tileH = this.scene.mapRef?.tileHeight ?? 16;
    const image = this.scene.add.image(obj.tileX * tileW, obj.tileY * tileH, textureKey);
    image.setOrigin(0, 0);
    if (!useDirectionalImage) {
      image.setRotation(Phaser.Math.DegToRad(obj.rotation));
    }
    image.setFlip(obj.flipX, obj.flipY);
    image.setDepth(obj.zIndex);
    const sf = obj.scaleFactor ?? 1;
    if (sf !== 1) image.setScale(sf);
    image.setVisible(this.spritesVisible);
    this.sprites.set(obj.id, image);
  }

  private loadTexture(key: string, url: string, onReady: () => void): void {
    if (this.pendingTextureLoads.has(key)) {
      this.pendingTextureLoads.get(key)!.push(onReady);
      return;
    }
    this.pendingTextureLoads.set(key, [onReady]);

    const resolvedUrl = url.startsWith('/') ? `${baseUrl()}${url}` : url;
    this.scene.load.image(key, resolvedUrl);
    this.scene.load.once('complete', () => {
      const callbacks = this.pendingTextureLoads.get(key);
      this.pendingTextureLoads.delete(key);
      if (callbacks) callbacks.forEach(cb => cb());
    });
    this.scene.load.start();
  }

  private async fetchObjectsByChunks(keys: string[]): Promise<MapObjectData[]> {
    if (keys.length === 0) return [];
    const mapId = this.scene.currentMapId;
    const qs = keys.join(',');
    const ts = Date.now();
    const url = `${baseUrl()}/maps/${encodeURIComponent(mapId)}/objects?chunks=${encodeURIComponent(qs)}&t=${ts}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch objects: ${res.status}`);
    return (await res.json()) as MapObjectData[];
  }
}
