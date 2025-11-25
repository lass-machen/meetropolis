/**
 * EditorInputHandler - Übersetzt Phaser Input-Events in Editor-Actions
 * 
 * Prinzipien:
 * - Keine Business-Logik
 * - Keine State-Verwaltung
 * - Nur Input → Action Translation
 * - Koordinaten-Transformation
 */

import Phaser from 'phaser';
import { EditorService, EditorAction } from '../../services/EditorService';
import { EditorRenderer } from './EditorRenderer';

export class EditorInputHandler {
  private scene: Phaser.Scene;
  private renderer: EditorRenderer;
  private tileSize: number;

  constructor(scene: Phaser.Scene, renderer: EditorRenderer, tileSize: number = 16) {
    this.scene = scene;
    this.renderer = renderer;
    this.tileSize = tileSize;

    this.setupInputHandlers();
  }

  private setupInputHandlers(): void {
    this.scene.input.on('pointerdown', this.handlePointerDown.bind(this));
    this.scene.input.on('pointermove', this.handlePointerMove.bind(this));
    this.scene.input.on('pointerup', this.handlePointerUp.bind(this));
  }

  private worldToTile(worldX: number, worldY: number): { tileX: number; tileY: number } {
    return {
      tileX: Math.floor(worldX / this.tileSize),
      tileY: Math.floor(worldY / this.tileSize),
    };
  }

  private tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
    return {
      x: tileX * this.tileSize + this.tileSize / 2,
      y: tileY * this.tileSize + this.tileSize / 2,
    };
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const state = EditorService.getState();

    if (!state.active) {
      return;
    }

    // Ignoriere wenn Kamera gepanned wird
    if (pointer.middleButtonDown() || this.isSpaceHeld()) {
      return;
    }

    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const { tileX, tileY } = this.worldToTile(worldPoint.x, worldPoint.y);

    try {
      this.dispatchToolAction('down', tileX, tileY);
    } catch (error) {
      console.error('Editor input error (down):', error);
      throw error;
    }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    const state = EditorService.getState();

    if (!state.active) {
      return;
    }

    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const { tileX, tileY } = this.worldToTile(worldPoint.x, worldPoint.y);

    // Update Ghost-Position wenn Asset-Tool aktiv
    if (state.tool === 'asset' && state.pendingAsset) {
      const worldPos = this.tileToWorld(tileX, tileY);
      this.renderer.updateGhostPosition(worldPos.x, worldPos.y);
    }

    // Update Drag wenn aktiv
    if (state.dragState) {
      try {
        this.dispatchToolAction('move', tileX, tileY);
      } catch (error) {
        console.error('Editor input error (move):', error);
        throw error;
      }
    }

    // Update Selection Preview
    if (state.tool !== 'select') {
      const x = tileX * this.tileSize;
      const y = tileY * this.tileSize;
      this.renderer.renderSelection({
        x,
        y,
        w: this.tileSize,
        h: this.tileSize,
      });
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    const state = EditorService.getState();

    if (!state.active) {
      return;
    }

    // Ignoriere wenn Kamera gepanned wird
    if (this.isSpaceHeld()) {
      return;
    }

    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const { tileX, tileY } = this.worldToTile(worldPoint.x, worldPoint.y);

    try {
      this.dispatchToolAction('up', tileX, tileY);
    } catch (error) {
      console.error('Editor input error (up):', error);
      throw error;
    }

    // Clear Selection nach Action
    this.renderer.renderSelection(null);
  }

  private dispatchToolAction(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    switch (state.tool) {
      case 'zone':
        this.handleZoneTool(phase, tileX, tileY);
        break;

      case 'asset':
        this.handleAssetTool(phase, tileX, tileY);
        break;

      case 'spawn':
        this.handleSpawnTool(phase, tileX, tileY);
        break;

      case 'erase':
        this.handleEraseTool(phase, tileX, tileY);
        break;

      case 'select':
        // Select hat keine Tile-Actions
        break;

      default:
        // Andere Tools (terrain, collision) werden direkt in Phaser Scene behandelt
        break;
    }
  }

  private handleZoneTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX, tileY });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_ZONE_DRAG', tileX, tileY });

      // Update Selection Preview
      const drag = state.dragState;
      const x0 = Math.min(drag.startTileX, tileX) * this.tileSize;
      const y0 = Math.min(drag.startTileY, tileY) * this.tileSize;
      const x1 = (Math.max(drag.startTileX, tileX) + 1) * this.tileSize;
      const y1 = (Math.max(drag.startTileY, tileY) + 1) * this.tileSize;

      this.renderer.renderSelection({
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
      });
    } else if (phase === 'up' && state.dragState) {
      EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX, tileY });
    }
  }

  private handleAssetTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (!state.pendingAsset) {
      return;
    }

    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX, tileY });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_ASSET_DRAG', tileX, tileY });

      // Update Selection Preview für Drag-Bereich
      const drag = state.dragState;
      const x0 = Math.min(drag.startTileX, tileX) * this.tileSize;
      const y0 = Math.min(drag.startTileY, tileY) * this.tileSize;
      const x1 = (Math.max(drag.startTileX, tileX) + 1) * this.tileSize;
      const y1 = (Math.max(drag.startTileY, tileY) + 1) * this.tileSize;

      this.renderer.renderSelection({
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
      });
    } else if (phase === 'up') {
      if (state.dragState) {
        EditorService.dispatch({ type: 'COMPLETE_ASSET_DRAG', tileX, tileY });
      } else {
        // Einzelner Click
        EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });
      }
    }
  }

  private handleSpawnTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    if (phase === 'up') {
      const x = tileX * this.tileSize + this.tileSize / 2;
      const y = tileY * this.tileSize + this.tileSize / 2;
      EditorService.dispatch({ type: 'SET_SPAWN', x, y });
    }
  }

  private handleEraseTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (state.category === 'objects' || state.category === 'structures') {
      // Erase Asset
      if (phase === 'down') {
        const worldPos = this.tileToWorld(tileX, tileY);
        const asset = this.findAssetAtPosition(worldPos.x, worldPos.y);
        if (asset) {
          EditorService.dispatch({ type: 'DELETE_ASSET', id: asset.id });
        }
      }
    }
    // Terrain/Collision Erase wird direkt in Scene behandelt
  }

  private findAssetAtPosition(x: number, y: number): { id: string } | null {
    const state = EditorService.getState();
    const radius = this.tileSize / 2;

    // Reverse search (zuletzt platziertes Asset zuerst)
    for (let i = state.assets.length - 1; i >= 0; i--) {
      const asset = state.assets[i];
      if (Math.abs(asset.x - x) <= radius && Math.abs(asset.y - y) <= radius) {
        return { id: asset.id };
      }
    }

    return null;
  }

  private isSpaceHeld(): boolean {
    const spaceKey = this.scene.input.keyboard?.addKey('SPACE');
    return spaceKey?.isDown || false;
  }

  public destroy(): void {
    this.scene.input.off('pointerdown', this.handlePointerDown);
    this.scene.input.off('pointermove', this.handlePointerMove);
    this.scene.input.off('pointerup', this.handlePointerUp);
  }
}

