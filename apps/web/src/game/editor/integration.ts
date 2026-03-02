/**
 * Editor Integration - Verbindet MainScene mit neuem Editor-System
 *
 * Initialisiert EditorRenderer und EditorInputHandler für eine Phaser Scene.
 * Im `rendererOnly` Modus wird kein EditorInputHandler erstellt – das ist für
 * die MainScene gedacht, in der der bestehende Input-Code weiterhin greift.
 */

import Phaser from 'phaser';
import { EditorRenderer } from './EditorRenderer';
import { EditorInputHandler } from './EditorInputHandler';
import { EditorService } from '../../services/EditorService';

export interface EditorIntegrationOptions {
  rendererOnly?: boolean;
}

export class EditorIntegration {
  private renderer: EditorRenderer;
  private inputHandler: EditorInputHandler | null = null;
  private stateUnsubscribe?: () => void;

  constructor(scene: Phaser.Scene, tileSize: number = 16, options?: EditorIntegrationOptions) {
    this.renderer = new EditorRenderer(scene);

    if (!options?.rendererOnly) {
      this.inputHandler = new EditorInputHandler(scene, this.renderer, tileSize);
    }

    this.subscribeToState();
  }

  private subscribeToState(): void {
    this.stateUnsubscribe = EditorService.subscribe((state) => {
      // Render Zones
      this.renderer.renderZones(state.zones, true);

      // Render Assets
      this.renderer.renderAssets(state.assets);

      // Render Spawn
      this.renderer.renderSpawn(state.spawn);

      // Render Ghost Preview für Asset-Tool
      // Terrain-Ghost wird über bridge.ts / setAssetPreview gehandhabt,
      // daher nur Asset-Ghost hier rendern.
      if (state.tool === 'asset' && state.pendingAsset) {
        const ghostPreview: { dataUrl: string; width?: number | undefined; height?: number | undefined } = {
          dataUrl: state.pendingAsset.dataUrl,
        };
        if (state.pendingAsset.width !== undefined) {
          ghostPreview.width = state.pendingAsset.width;
        }
        if (state.pendingAsset.height !== undefined) {
          ghostPreview.height = state.pendingAsset.height;
        }
        this.renderer.renderGhost(ghostPreview);
      } else {
        this.renderer.renderGhost(null);
      }

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
    });
  }

  /**
   * Gibt Ressourcen frei
   */
  public destroy(): void {
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
    }

    this.inputHandler?.destroy();
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
  public getInputHandler(): EditorInputHandler | null {
    return this.inputHandler;
  }
}

/**
 * Helper-Funktion für MainScene
 * Initialisiert das neue Editor-System
 */
export function initializeEditorSystem(scene: Phaser.Scene, tileSize: number = 16): EditorIntegration {
  return new EditorIntegration(scene, tileSize);
}
