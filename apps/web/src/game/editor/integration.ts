/**
 * Editor Integration - Verbindet MainScene mit neuem Editor-System
 *
 * Initialisiert EditorRenderer und EditorInputHandler für eine Phaser Scene.
 * Hält Tilemap-Manager-Referenzen, um Terrain-Paints lokal sofort anzuwenden
 * und eine Terrain-Ghost-Preview bereitzustellen.
 */

import Phaser from 'phaser';
import { EditorRenderer } from './EditorRenderer';
import { EditorInputHandler } from './EditorInputHandler';
import { EditorService } from '../../services/EditorService';
import type { TerrainPaintOp } from '../../services/EditorTypes';
import { updateCollisionOverlay } from '../collision/overlay';

export interface EditorIntegrationOptions {
  tileManager?: any;        // TileManager instance for local tile painting
  autotileGrid?: any;       // AutotileGrid instance for wall painting
  autotileRenderer?: any;   // AutotileRenderer instance for wall rendering
  collisionManager?: any;   // CollisionManager for collision rebuilds
}

export class EditorIntegration {
  private renderer: EditorRenderer;
  private inputHandler: EditorInputHandler;
  private stateUnsubscribe?: () => void;
  private scene: Phaser.Scene;

  // Tilemap references for local paint application
  private tileManager: any;
  private autotileGrid: any;
  private autotileRenderer: any;
  private collisionManager: any;

  // Generation counter for terrain ghost preview (prevents stale async results)
  private terrainPreviewGeneration = 0;

  constructor(scene: Phaser.Scene, tileSize: number = 16, options?: EditorIntegrationOptions) {
    this.scene = scene;
    this.renderer = new EditorRenderer(scene);
    this.inputHandler = new EditorInputHandler(scene, this.renderer, tileSize);

    // Store tilemap references for local paint application
    this.tileManager = options?.tileManager ?? null;
    this.autotileGrid = options?.autotileGrid ?? null;
    this.autotileRenderer = options?.autotileRenderer ?? null;
    this.collisionManager = options?.collisionManager ?? null;

    this.subscribeToState();
  }

  private subscribeToState(): void {
    let lastGhostKey: string | null = null;
    let lastTerrainPaintCount = 0;
    let lastTerrainGhostKey: string | null = null;

    this.stateUnsubscribe = EditorService.subscribe((state) => {
      // When editor is inactive, clear all overlays and skip rendering
      if (!state.active) {
        this.renderer.clearAll();
        lastGhostKey = null;
        lastTerrainGhostKey = null;
        lastTerrainPaintCount = 0;
        return;
      }

      // Render Zones
      this.renderer.renderZones(state.zones, true);

      // Render Assets
      this.renderer.renderAssets(state.assets);

      // Render Spawn
      this.renderer.renderSpawn(state.spawn);

      // Ghost: NUR bei Änderung re-rendern (for asset tool)
      const ghostKey = (state.tool === 'asset' && state.pendingAsset)
        ? `${state.pendingAsset.packUuid || ''}:${state.pendingAsset.itemId || ''}:${state.pendingAsset.key}|${state.pendingAsset.rotation ?? 0}|${state.pendingAsset.scaleFactor ?? 1}`
        : null;

      if (ghostKey !== lastGhostKey) {
        lastGhostKey = ghostKey;
        if (ghostKey && state.pendingAsset) {
          this.renderer.renderGhost({
            dataUrl: state.pendingAsset.dataUrl,
            width: state.pendingAsset.width,
            height: state.pendingAsset.height,
            scaleFactor: state.pendingAsset.scaleFactor,
            rotation: state.pendingAsset.rotation,
            packUuid: state.pendingAsset.packUuid,
            itemId: state.pendingAsset.itemId,
          });
        } else {
          this.renderer.renderGhost(null);
        }
      }

      // Terrain Ghost Preview (for terrain tool with selected tile)
      const terrainGhostKey = (state.tool === 'terrain' && state.selectedTileRefId > 0)
        ? `terrain:${state.selectedTileRefId}`
        : null;
      if (terrainGhostKey !== lastTerrainGhostKey) {
        lastTerrainGhostKey = terrainGhostKey;
        if (terrainGhostKey) {
          this.updateTerrainGhost(state.selectedTileRefId);
        } else if (state.tool !== 'asset' || !state.pendingAsset) {
          this.renderer.renderGhost(null);
        }
      }

      // Render Pending Delete Overlays
      this.renderer.renderPendingDeletes(state.pendingChanges.objectsToDelete, state.mapObjects);

      // Render Selection basierend auf Drag-State
      if (state.dragState) {
        const tileSize = 16;
        const x0 = Math.min(state.dragState.startTileX, state.dragState.endTileX) * tileSize;
        const y0 = Math.min(state.dragState.startTileY, state.dragState.endTileY) * tileSize;
        const x1 = (Math.max(state.dragState.startTileX, state.dragState.endTileX) + 1) * tileSize;
        const y1 = (Math.max(state.dragState.startTileY, state.dragState.endTileY) + 1) * tileSize;

        this.renderer.renderSelection({
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y1 - y0,
        });
      }

      // Apply new terrain paints locally
      const currentPaintCount = state.pendingChanges.terrainPaints.length;
      if (currentPaintCount > lastTerrainPaintCount) {
        const newPaints = state.pendingChanges.terrainPaints.slice(lastTerrainPaintCount);
        for (const paint of newPaints) {
          this.applyLocalPaint(paint);
        }
      }
      lastTerrainPaintCount = currentPaintCount;
    });
  }

  /** Applies a single terrain paint operation to the local Phaser tilemap */
  private applyLocalPaint(paint: TerrainPaintOp): void {
    const { layer, rect, tileRefId, erase } = paint;

    if (layer === 'ground' || layer === 'walls') {
      // Ground/Walls painting via TileManager
      if (this.tileManager?.paintTerrainRect) {
        this.tileManager.paintTerrainRect(layer, rect, tileRefId);
      }
    } else if (layer === 'walls_auto') {
      // Autotile wall painting
      if (this.autotileGrid && this.autotileRenderer) {
        const affected: Array<{ x: number; y: number }> = [];
        for (let ty = rect.y0; ty <= rect.y1; ty++) {
          for (let tx = rect.x0; tx <= rect.x1; tx++) {
            if (tileRefId > 0) {
              this.autotileGrid.set(tx, ty, tileRefId);
            } else {
              this.autotileGrid.remove(tx, ty);
            }
            affected.push({ x: tx, y: ty });
            affected.push({ x: tx, y: ty - 1 });
            affected.push({ x: tx + 1, y: ty });
            affected.push({ x: tx, y: ty + 1 });
            affected.push({ x: tx - 1, y: ty });
          }
        }
        this.autotileRenderer.updateArea(affected);
      }
    } else if (layer === 'collision') {
      // Collision painting via TileManager.applyTilePaint
      if (this.tileManager?.applyTilePaint) {
        const tileIndex = (erase || tileRefId === 0) ? -1 : 1;
        this.tileManager.applyTilePaint(
          {
            layer: 'Collision' as const,
            tilesetKey: 'collision_tiles',
            tileIndex,
            rect: { startX: rect.x0, startY: rect.y0, endX: rect.x1, endY: rect.y1 },
          },
          true, // collisionVisible — always true in editor mode
          () => {
            // Rebuild collision and update visual overlay
            if (this.collisionManager) {
              this.collisionManager.ensureCollisionCollider?.();
              this.collisionManager.rebuildStaticColliders?.();
            }
            updateCollisionOverlay(this.scene as any);
          },
        );
      }
    }
  }

  /** Generates a ghost preview image from the selected terrain tile */
  private updateTerrainGhost(tileRefId: number): void {
    const gen = ++this.terrainPreviewGeneration;

    void (async () => {
      try {
        // Import splitTileRefId and fetchStateV2 dynamically to avoid circular deps
        const { splitTileRefId, fetchStateV2, baseUrl: mapV2BaseUrl } = await import('../../lib/mapV2');
        const { useMapStore } = await import('../../state/mapStore');

        // Get tileset registry from V2 state
        let tilesetRegistry: Array<{
          slot: number; key: string; imageUrl: string;
          tileWidth: number; tileHeight: number;
          margin?: number | null; spacing?: number | null;
        }> = [];

        const mapId = useMapStore.getState().currentMapId;
        if (mapId) {
          const v2State = await fetchStateV2(mapId);
          if (v2State?.tilesetRegistry) {
            tilesetRegistry = v2State.tilesetRegistry;
          }
        }

        if (gen !== this.terrainPreviewGeneration) return;

        const { slot, tileIndex } = splitTileRefId(tileRefId);
        const ts = tilesetRegistry.find((t) => t.slot === slot);
        if (!ts || !ts.imageUrl) return;

        const resolveUrl = (url: string): string => {
          if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
          return `${mapV2BaseUrl()}${url}`;
        };

        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = resolveUrl(ts.imageUrl);
        });

        if (gen !== this.terrainPreviewGeneration) return;

        const tw = ts.tileWidth || 16;
        const th = ts.tileHeight || 16;
        const margin = ts.margin ?? 0;
        const spacing = ts.spacing ?? 0;
        const cols = Math.max(1, Math.floor((img.width - 2 * margin + spacing) / (tw + spacing)));
        const col = tileIndex % cols;
        const row = Math.floor(tileIndex / cols);
        const sx = margin + col * (tw + spacing);
        const sy = margin + row * (th + spacing);

        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, sx, sy, tw, th, 0, 0, tw, th);
          const dataUrl = canvas.toDataURL('image/png');
          this.renderer.renderGhost({ dataUrl, width: tw, height: th });
        }
      } catch {
        // Silently fail — terrain ghost is a nice-to-have
      }
    })();
  }

  /**
   * Gibt Ressourcen frei
   */
  public destroy(): void {
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
    }

    this.inputHandler.destroy();
    this.renderer.destroy();
  }

  /**
   * Gibt den Renderer zurück (für manuelle Operationen)
   */
  public getRenderer(): EditorRenderer {
    return this.renderer;
  }

  /**
   * Gibt den InputHandler zurück
   */
  public getInputHandler(): EditorInputHandler {
    return this.inputHandler;
  }

  /**
   * Updates cursor highlight to the given tile position
   */
  public updateCursorTile(tileX: number, tileY: number, tileSize: number): void {
    this.renderer.renderCursorHighlight(tileX, tileY, tileSize);
  }

  /**
   * Clears the cursor highlight
   */
  public clearCursorHighlight(): void {
    this.renderer.clearCursorHighlight();
  }
}

/**
 * Helper-Funktion für MainScene
 * Initialisiert das neue Editor-System
 */
export function initializeEditorSystem(
  scene: Phaser.Scene,
  tileSize: number = 16,
  options?: EditorIntegrationOptions,
): EditorIntegration {
  return new EditorIntegration(scene, tileSize, options);
}
