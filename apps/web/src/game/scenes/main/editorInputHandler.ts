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
  ghostSprite?: Phaser.GameObjects.Image | undefined;
  selectionG?: Phaser.GameObjects.Graphics | undefined;
  getEditorRenderer?: (() => import('../../editor/EditorRenderer').EditorRenderer | null) | undefined;
}

export class EditorInputHandler {
  private scene: Phaser.Scene;
  private mapRef: Phaser.Tilemaps.Tilemap;
  private getEditorMode: () => boolean;
  private isPanning: () => boolean;
  private isSpaceHeld: () => boolean;
  private getSpaceKey: () => Phaser.Input.Keyboard.Key | undefined;
  private ghostSprite: Phaser.GameObjects.Image | undefined;
  private selectionG: Phaser.GameObjects.Graphics | undefined;
  private dragStartTile: { x: number; y: number } | undefined;
  private ghostDataUrl: string | undefined;
  private getEditorRendererFn: (() => import('../../editor/EditorRenderer').EditorRenderer | null) | null;

  constructor(config: EditorInputConfig) {
    this.scene = config.scene;
    this.mapRef = config.mapRef;
    this.getEditorMode = config.getEditorMode;
    this.isPanning = config.isPanning;
    this.isSpaceHeld = config.isSpaceHeld;
    this.getSpaceKey = config.getSpaceKey;
    this.ghostSprite = config.ghostSprite;
    this.selectionG = config.selectionG;
    this.getEditorRendererFn = config.getEditorRenderer ?? null;
  }

  init() {
    this.setupPointerHandlers();
    this.setupKeyboardShortcuts();
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

  private setupKeyboardShortcuts() {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.getEditorMode()) return;

      // Ctrl/Cmd+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:save'));
        return;
      }

      // Skip shortcuts when focused on form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      this.handleEditorShortcut(e);
    };

    window.addEventListener('keydown', onKeyDown);
  }

  private handleEditorShortcut(e: KeyboardEvent) {
    switch (e.key) {
      case '1': EditorService.dispatch({ type: 'SET_TOOL', tool: 'select' }); break;
      case '2': EditorService.dispatch({ type: 'SET_TOOL', tool: 'terrain' }); break;
      case '3': EditorService.dispatch({ type: 'SET_TOOL', tool: 'asset' }); break;
      case '4': EditorService.dispatch({ type: 'SET_TOOL', tool: 'collision' }); break;
      case '5': EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' }); break;
      case '6': EditorService.dispatch({ type: 'SET_TOOL', tool: 'spawn' }); break;
      case '7': EditorService.dispatch({ type: 'SET_TOOL', tool: 'erase' }); break;
      case 'g': EditorService.dispatch({ type: 'TOGGLE_GRID' }); break;
      case 'c': EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'collision' }); break;
      case 'Delete':
      case 'Backspace':
        this.handleDeleteShortcut();
        break;
    }
  }

  private handleDeleteShortcut() {
    const selectedId = EditorService.getState().selectedObjectId;
    if (!selectedId) return;
    const obj = EditorService.getState().mapObjects.find(o => String(o.id) === selectedId);
    if (obj) {
      EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: obj.id });
      EditorService.dispatch({ type: 'SELECT_MAP_OBJECT', objectId: null });
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const worldPoint = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    const isPanStart = pointer.middleButtonDown() ||
                      ((this.isSpaceHeld() || !!this.getSpaceKey()?.isDown) && pointer.leftButtonDown());

    if (pointer.rightButtonDown()) {
      try { (pointer.event as any)?.preventDefault?.(); } catch { }
      return;
    }

    const editorState = EditorService.getState();
    const assetPreviewActive = editorState.tool === 'asset' && !!editorState.pendingAsset;
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
      const isWallTool = editorTool === 'wall';

      if (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision || isWallTool) {
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

      const renderer = this.getEditorRendererFn?.();
      if (renderer) {
        renderer.renderCursorHighlight(tileX, tileY, this.mapRef.tileWidth);
      }
    }

    this.updateGhostSprite(tileX, tileY);
    this.updateDragSelection(pointer, tileX, tileY);
  }

  private updateGhostSprite(tileX: number, tileY: number) {
    const x = tileX * this.mapRef.tileWidth + this.mapRef.tileWidth / 2;
    const y = tileY * this.mapRef.tileHeight + this.mapRef.tileHeight / 2;

    const renderer = this.getEditorRendererFn?.();
    if (renderer) {
      renderer.updateGhostPosition(x, y);
    } else if (this.ghostSprite) {
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
      const isWallTool = editorTool === 'wall';

      if (this.getEditorMode() && ds && pointer.leftButtonDown() &&
          !this.isPanning() &&
          (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision || isWallTool)) {
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

        // V2 terrain painting with tileRefId
        if (editorTool === 'terrain' && editorState.selectedTileRefId > 0) {
          const x0 = Math.min(rect.startX, rect.endX);
          const y0 = Math.min(rect.startY, rect.endY);
          const x1 = Math.max(rect.startX, rect.endX);
          const y1 = Math.max(rect.startY, rect.endY);

          gameBridge.applyTerrainPaintV2({
            rect: { x0, y0, x1, y1 },
            tileRefId: editorState.selectedTileRefId,
            layer: 'ground',
          });

          EditorService.dispatch({
            type: 'ADD_PENDING_TERRAIN_PAINT',
            paint: {
              layer: 'ground',
              rect: { x0, y0, x1, y1 },
              tileRefId: editorState.selectedTileRefId,
            },
          });
          return;
        }

        if (this.ghostSprite && this.ghostDataUrl && editorTool === 'terrain') {
          gameBridge.applyTerrainPaint({ rect, dataUrl: this.ghostDataUrl });
        } else if (editorTool === 'collision' || editorTool === 'erase') {
          this.handleCollisionOrErase(editorState, editorTool, rect);
        } else if (editorTool === 'wall') {
          gameBridge.applyWallPaint({ rect, wallTypeId: editorState.selectedWallTypeId });
        }
      }
    } catch { }
  }

  private handleCollisionOrErase(
    editorState: ReturnType<typeof EditorService.getState>,
    editorTool: string,
    rect: { startX: number; startY: number; endX: number; endY: number }
  ) {
    if (editorState.category === 'terrain' && editorTool === 'erase') {
      gameBridge.eraseTerrainRect(rect);
      // Also register pending change for V2
      const x0 = Math.min(rect.startX, rect.endX);
      const y0 = Math.min(rect.startY, rect.endY);
      const x1 = Math.max(rect.startX, rect.endX);
      const y1 = Math.max(rect.startY, rect.endY);
      EditorService.dispatch({
        type: 'ADD_PENDING_TERRAIN_PAINT',
        paint: { layer: 'ground', rect: { x0, y0, x1, y1 }, tileRefId: 0 },
      });
    } else if (editorState.category === 'collisions') {
      const tileIndex = editorTool === 'erase' ? -1 : 1;
      const edit = {
        layer: 'Collision' as const,
        tilesetKey: 'collision_tiles',
        tileIndex,
        rect
      };
      gameBridge.applyTilePaint(edit);
    } else if (editorState.category === 'terrain' && editorTool === 'collision') {
      const edit = {
        layer: 'Collision' as const,
        tilesetKey: 'collision_tiles',
        tileIndex: 1,
        rect
      };
      gameBridge.applyTilePaint(edit);
    }

    // Enhanced erase: also delete objects in rect area
    if (editorTool === 'erase') {
      this.eraseObjectsInRect(rect);
    }
  }

  private eraseObjectsInRect(
    rect: { startX: number; startY: number; endX: number; endY: number }
  ) {
    const x0 = Math.min(rect.startX, rect.endX);
    const y0 = Math.min(rect.startY, rect.endY);
    const x1 = Math.max(rect.startX, rect.endX);
    const y1 = Math.max(rect.startY, rect.endY);
    const currentState = EditorService.getState();
    const objectsInRect = currentState.mapObjects.filter(obj =>
      obj.tileX >= x0 && obj.tileX <= x1 && obj.tileY >= y0 && obj.tileY <= y1
    );
    for (const obj of objectsInRect) {
      EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: obj.id });
    }
  }

  private cleanupDragSelection() {
    const editorTool = EditorService.getState().tool;
    const isTerrainCollisionTool = editorTool === 'terrain' ||
                                   editorTool === 'collision' ||
                                   editorTool === 'erase' ||
                                   editorTool === 'wall';

    if (isTerrainCollisionTool) {
      this.setSelectionRect(null);
      this.dragStartTile = undefined;
    }
  }

  private setSelectionRect(rect: { x: number; y: number; w: number; h: number } | null) {
    const renderer = this.getEditorRendererFn?.();
    if (renderer) {
      renderer.renderSelection(rect);
      return;
    }

    // Fallback: direct Phaser graphics rendering when no EditorRenderer is available
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

  setGhostSprite(sprite: Phaser.GameObjects.Image | undefined) {
    this.ghostSprite = sprite;
  }

  setGhostDataUrl(dataUrl: string | undefined) {
    this.ghostDataUrl = dataUrl;
  }

  setSelectionGraphics(graphics: Phaser.GameObjects.Graphics | undefined) {
    this.selectionG = graphics;
  }
}
