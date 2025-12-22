import Phaser from 'phaser';
import { EditorService } from '../../../services/EditorService';
import { gameBridge } from '../../bridge';
import { logger } from '../../../lib/logger';

export interface EditorInputConfig {
  scene: Phaser.Scene;
  mapRef: Phaser.Tilemaps.Tilemap;
  getEditorMode: () => boolean;
  isPanning: () => boolean;
  isSpaceHeld: () => boolean;
  getSpaceKey: () => Phaser.Input.Keyboard.Key | undefined;
  ghostSprite?: Phaser.GameObjects.Image;
  selectionG?: Phaser.GameObjects.Graphics;
}

export class EditorInputHandler {
  private scene: Phaser.Scene;
  private mapRef: Phaser.Tilemaps.Tilemap;
  private getEditorMode: () => boolean;
  private isPanning: () => boolean;
  private isSpaceHeld: () => boolean;
  private getSpaceKey: () => Phaser.Input.Keyboard.Key | undefined;
  private ghostSprite?: Phaser.GameObjects.Image;
  private selectionG?: Phaser.GameObjects.Graphics;
  private dragStartTile?: { x: number; y: number };
  private ghostDataUrl?: string;

  constructor(config: EditorInputConfig) {
    this.scene = config.scene;
    this.mapRef = config.mapRef;
    this.getEditorMode = config.getEditorMode;
    this.isPanning = config.isPanning;
    this.isSpaceHeld = config.isSpaceHeld;
    this.getSpaceKey = config.getSpaceKey;
    this.ghostSprite = config.ghostSprite;
    this.selectionG = config.selectionG;
  }

  init() {
    this.setupPointerHandlers();
  }

  private toTile(p: Phaser.Input.Pointer): { tileX: number; tileY: number } {
    const wp = p.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const tileX = Math.floor(wp.x / this.mapRef.tileWidth);
    const tileY = Math.floor(wp.y / this.mapRef.tileHeight);
    return { tileX, tileY };
  }

  private setupPointerHandlers() {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(pointer);
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerMove(pointer);
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerUp(pointer);
    });
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const isPanStart = pointer.middleButtonDown() ||
                      ((this.isSpaceHeld() || !!this.getSpaceKey()?.isDown) && pointer.leftButtonDown());

    if (pointer.rightButtonDown()) {
      try { (pointer.event as any)?.preventDefault?.(); } catch { }
      return;
    }

    const assetPreviewActive = !!this.ghostSprite;
    if (!isPanStart && this.getEditorMode()) {
      if (!assetPreviewActive) {
        gameBridge.onPointerDown({ x: worldPoint.x, y: worldPoint.y });
      }

      const { tileX, tileY } = this.toTile(pointer);
      try {
        window.dispatchEvent(new CustomEvent('editor:tileDown', { detail: { tileX, tileY } }));
      } catch { }

      gameBridge.onPointerDownTile({ tileX, tileY });

      this.startDragSelection(tileX, tileY);
    }
  }

  private startDragSelection(tileX: number, tileY: number) {
    try {
      const editorState = EditorService.getState();
      const editorTool = editorState.tool;
      const isTerrainCollisionTool = editorTool === 'terrain' || editorTool === 'collision';
      const isEraseForTerrain = editorTool === 'erase' && editorState.category === 'terrain';
      const isEraseForCollision = editorTool === 'erase' && editorState.category === 'collisions';

      if (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision) {
        this.dragStartTile = { x: tileX, y: tileY };
        const x = tileX * this.mapRef.tileWidth;
        const y = tileY * this.mapRef.tileHeight;
        this.setSelectionRect({
          x,
          y,
          w: this.mapRef.tileWidth,
          h: this.mapRef.tileHeight
        });
      }
    } catch { }
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    const { tileX, tileY } = this.toTile(pointer);

    try {
      if (this.getEditorMode() && !this.isPanning()) {
        window.dispatchEvent(new CustomEvent('editor:tileMove', { detail: { tileX, tileY } }));
      }
    } catch { }

    if (this.getEditorMode() && !this.isPanning()) {
      gameBridge.onPointerMoveTile({ tileX, tileY });
    }

    this.updateGhostSprite(tileX, tileY);
    this.updateDragSelection(pointer, tileX, tileY);
  }

  private updateGhostSprite(tileX: number, tileY: number) {
    if (this.ghostSprite) {
      const x = tileX * this.mapRef.tileWidth + this.mapRef.tileWidth / 2;
      const y = tileY * this.mapRef.tileHeight + this.mapRef.tileHeight / 2;

      if (Math.abs(this.ghostSprite.x - x) > 0.01 || Math.abs(this.ghostSprite.y - y) > 0.01) {
        this.ghostSprite.setPosition(x, y);
      }
    }
  }

  private updateDragSelection(pointer: Phaser.Input.Pointer, tileX: number, tileY: number) {
    try {
      const ds = this.dragStartTile;
      const editorState = EditorService.getState();
      const editorTool = editorState.tool;
      const isTerrainCollisionTool = editorTool === 'terrain' || editorTool === 'collision';
      const isEraseForTerrain = editorTool === 'erase' && editorState.category === 'terrain';
      const isEraseForCollision = editorTool === 'erase' && editorState.category === 'collisions';

      if (this.getEditorMode() && ds && pointer.leftButtonDown() &&
          !this.isPanning() &&
          (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision)) {
        const sx = Math.min(ds.x, tileX) * this.mapRef.tileWidth;
        const sy = Math.min(ds.y, tileY) * this.mapRef.tileHeight;
        const ex = Math.max(ds.x, tileX) * this.mapRef.tileWidth + this.mapRef.tileWidth;
        const ey = Math.max(ds.y, tileY) * this.mapRef.tileHeight + this.mapRef.tileHeight;
        this.setSelectionRect({ x: sx, y: sy, w: ex - sx, h: ey - sy });
      }
    } catch { }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    const { tileX, tileY } = this.toTile(pointer);

    if (this.getEditorMode() && !this.isPanning()) {
      logger.debug('[EditorInputHandler] pointerup tile:', tileX, tileY);
      try {
        window.dispatchEvent(new CustomEvent('editor:tileUp', { detail: { tileX, tileY } }));
      } catch { }
      gameBridge.onPointerUpTile({ tileX, tileY });
    }

    this.applyEditorAction(tileX, tileY);
    this.cleanupDragSelection();
  }

  private applyEditorAction(tileX: number, tileY: number) {
    try {
      const ds = this.dragStartTile;
      const editorState = EditorService.getState();
      const editorTool = editorState.tool;

      if (this.getEditorMode() && ds) {
        const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };

        if (this.ghostSprite && this.ghostDataUrl && editorTool === 'terrain') {
          gameBridge.onApplyTerrainPaint?.({ rect, dataUrl: this.ghostDataUrl });
        } else if (editorTool === 'collision' || editorTool === 'erase') {
          this.handleCollisionOrErase(editorState, editorTool, rect);
        }
      }
    } catch { }
  }

  private handleCollisionOrErase(
    editorState: any,
    editorTool: string,
    rect: { startX: number; startY: number; endX: number; endY: number }
  ) {
    if (editorState.category === 'terrain' && editorTool === 'erase') {
      gameBridge.onEraseTerrainRect?.(rect);
    } else if (editorState.category === 'collisions') {
      const tileIndex = editorTool === 'erase' ? -1 : 1;
      const edit = {
        layer: 'Collision' as const,
        tilesetKey: 'collision_tiles',
        tileIndex,
        rect
      };
      gameBridge.onApplyTilePaint?.(edit);
    } else if (editorState.category === 'terrain' && editorTool === 'collision') {
      const edit = {
        layer: 'Collision' as const,
        tilesetKey: 'collision_tiles',
        tileIndex: 1,
        rect
      };
      gameBridge.onApplyTilePaint?.(edit);
    }
  }

  private cleanupDragSelection() {
    const editorTool = EditorService.getState().tool;
    const isTerrainCollisionTool = editorTool === 'terrain' ||
                                   editorTool === 'collision' ||
                                   editorTool === 'erase';

    if (isTerrainCollisionTool) {
      this.setSelectionRect(null);
      this.dragStartTile = undefined;
    }
  }

  private setSelectionRect(rect: { x: number; y: number; w: number; h: number } | null) {
    if (!rect) {
      if (this.selectionG) {
        this.selectionG.clear();
      }
      return;
    }

    if (!this.selectionG || !this.selectionG.scene) {
      this.selectionG = this.scene.add.graphics();
      this.selectionG.setDepth(7);
    }

    const g = this.selectionG;
    g.clear();
    g.lineStyle(1, 0x22d3ee, 1);
    g.fillStyle(0x22d3ee, 0.12);
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  setGhostSprite(sprite?: Phaser.GameObjects.Image) {
    this.ghostSprite = sprite;
  }

  setGhostDataUrl(dataUrl?: string) {
    this.ghostDataUrl = dataUrl;
  }

  setSelectionGraphics(graphics?: Phaser.GameObjects.Graphics) {
    this.selectionG = graphics;
  }
}
