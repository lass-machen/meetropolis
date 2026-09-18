import type { V2Autotile } from '../../lib/mapV2';
import { baseUrl } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import type { AutotileDefRuntime } from './AutotileRenderer';

interface AutotileDefinitionRenderer {
  registerDefinition(wallTypeId: number, definition: AutotileDefRuntime): void;
  updateAllVisible(): void;
}

interface CanvasTexture {
  context?: CanvasRenderingContext2D | null;
  refresh(): void;
}

interface TextureManager {
  exists(key: string): boolean;
  addSpriteSheet(key: string, source: HTMLImageElement, config: { frameWidth: number; frameHeight: number }): unknown;
  createCanvas(key: string, width: number, height: number): CanvasTexture | null;
}

interface AutotileTextureScene {
  textures: TextureManager;
  currentMapId: string;
  autotileRenderer?: AutotileDefinitionRenderer;
}

function fallbackSnapshotHash(item: V2Autotile): string {
  const snapshot = JSON.stringify({
    imageUrl: item.imageUrl,
    tileWidth: item.tileWidth,
    tileHeight: item.tileHeight,
    gridHeight: item.gridHeight,
    variants: item.variants,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < snapshot.length; index++) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy-${(hash >>> 0).toString(16)}`;
}

export function autotileTextureKey(mapId: string, item: V2Autotile): string {
  const snapshotHash = item.hash || fallbackSnapshotHash(item);
  return `autotile:${encodeURIComponent(mapId)}:${item.slot}:${snapshotHash}`;
}

function runtimeDefinition(item: V2Autotile, textureKey: string): AutotileDefRuntime {
  return {
    key: item.key,
    tileWidth: item.tileWidth,
    tileHeight: item.tileHeight,
    gridHeight: item.gridHeight,
    variants: item.variants,
    textureKey,
  };
}

function placeholderDimensions(item: V2Autotile): { width: number; height: number } {
  const frames = Object.values(item.variants);
  const columns = Math.max(1, ...frames.map((frame) => frame.col + 1));
  const rows = Math.max(1, ...frames.map((frame) => frame.row + 1));
  return { width: columns * item.tileWidth, height: rows * item.tileHeight };
}

function createMissingTexture(scene: AutotileTextureScene, key: string, item: V2Autotile): void {
  if (scene.textures.exists(key)) return;
  const size = placeholderDimensions(item);
  const texture = scene.textures.createCanvas(key, size.width, size.height);
  const context = texture?.context;
  if (!texture || !context) return;
  context.fillStyle = '#ff00ff';
  context.fillRect(0, 0, size.width, size.height);
  context.strokeStyle = '#000000';
  context.lineWidth = Math.max(1, Math.floor(item.tileWidth / 8));
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(size.width, size.height);
  context.moveTo(size.width, 0);
  context.lineTo(0, size.height);
  context.stroke();
  texture.refresh();
}

export class AutotileTextureLoader {
  private generation = 1;
  private active = true;
  private readonly pending = new Set<HTMLImageElement>();

  constructor(
    private readonly scene: AutotileTextureScene,
    private readonly mapId: string,
    private readonly renderer: AutotileDefinitionRenderer,
  ) {}

  register(items: V2Autotile[]): void {
    for (const item of items) this.load(item);
  }

  private isCurrent(generation: number, scene: AutotileTextureScene, renderer: AutotileDefinitionRenderer): boolean {
    return (
      this.active &&
      generation === this.generation &&
      scene === this.scene &&
      scene.currentMapId === this.mapId &&
      scene.autotileRenderer === renderer
    );
  }

  private load(item: V2Autotile): void {
    const generation = this.generation;
    const scene = this.scene;
    const renderer = this.renderer;
    const textureKey = autotileTextureKey(this.mapId, item);
    const finish = () => {
      if (!this.isCurrent(generation, scene, renderer)) return;
      renderer.registerDefinition(item.slot, runtimeDefinition(item, textureKey));
      renderer.updateAllVisible();
    };
    if (scene.textures.exists(textureKey)) {
      finish();
      return;
    }

    const image = new Image();
    this.pending.add(image);
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      this.pending.delete(image);
      if (!this.isCurrent(generation, scene, renderer)) return;
      if (!scene.textures.exists(textureKey)) {
        scene.textures.addSpriteSheet(textureKey, image, {
          frameWidth: item.tileWidth,
          frameHeight: item.tileHeight,
        });
      }
      finish();
    };
    image.onerror = () => {
      this.pending.delete(image);
      if (!this.isCurrent(generation, scene, renderer)) return;
      logger.error(`[Autotile] Missing snapshot texture for map "${this.mapId}", slot ${item.slot}: ${item.imageUrl}`);
      createMissingTexture(scene, textureKey, item);
      finish();
    };
    image.src = item.imageUrl.startsWith('/') ? `${baseUrl()}${item.imageUrl}` : item.imageUrl;
  }

  destroy(): void {
    this.active = false;
    this.generation++;
    for (const image of this.pending) {
      image.onload = null;
      image.onerror = null;
    }
    this.pending.clear();
  }
}
