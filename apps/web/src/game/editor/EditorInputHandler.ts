/**
 * EditorInputHandler: translate Phaser input events into editor actions.
 *
 * Principles:
 * - No business logic.
 * - No state ownership.
 * - Pure input to action translation.
 * - Coordinate transformation.
 */

import Phaser from 'phaser';
import { EditorService } from '../../services/EditorService';
import { EditorRenderer } from './EditorRenderer';
import { logger } from '../../lib/logger';

export class EditorInputHandler {
  private scene: Phaser.Scene;
  private renderer: EditorRenderer;
  private tileSize: number;
  // Bound handler refs must be identical between on() and off(),
  // otherwise Phaser cannot remove the listener.
  private boundHandlePointerDown!: (pointer: Phaser.Input.Pointer) => void;
  private boundHandlePointerMove!: (pointer: Phaser.Input.Pointer) => void;
  private boundHandlePointerUp!: (pointer: Phaser.Input.Pointer) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  // Selection-Rect colors per tool
  private static readonly TOOL_COLORS: Record<string, number> = {
    terrain: 0x3b82f6, // blue
    wall: 0x8b5a2b, // brown
    collision: 0xed4245, // red
    erase: 0xed4245, // red
    zone: 0x3b82f6, // blue (default)
  };

  constructor(scene: Phaser.Scene, renderer: EditorRenderer, tileSize: number = 16) {
    this.scene = scene;
    this.renderer = renderer;
    this.tileSize = tileSize;

    this.setupInputHandlers();
    this.setupKeyboardShortcuts();
  }

  private setupInputHandlers(): void {
    this.boundHandlePointerDown = this.handlePointerDown.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerUp = this.handlePointerUp.bind(this);
    this.scene.input.on('pointerdown', this.boundHandlePointerDown);
    this.scene.input.on('pointermove', this.boundHandlePointerMove);
    this.scene.input.on('pointerup', this.boundHandlePointerUp);

    this.scene.input.keyboard?.on('keydown-R', () => {
      const state = EditorService.getState();
      if (state.active && state.pendingAsset?.rotationAllowed) {
        EditorService.dispatch({ type: 'ROTATE_PENDING_ASSET' });
      }
    });
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
      logger.error('Editor input error (down):', error);
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

    // Update Ghost-Position wenn Asset-Tool oder Terrain-Tool aktiv
    if (state.tool === 'asset' && state.pendingAsset) {
      const worldPos = this.tileToWorld(tileX, tileY);
      this.renderer.updateGhostPosition(worldPos.x, worldPos.y);
    } else if (state.tool === 'terrain' && !state.dragState) {
      const worldPos = this.tileToWorld(tileX, tileY);
      this.renderer.updateGhostPosition(worldPos.x, worldPos.y);
    }

    // Update Drag wenn aktiv
    if (state.dragState) {
      try {
        this.dispatchToolAction('move', tileX, tileY);
      } catch (error) {
        logger.error('Editor input error (move):', error);
        throw error;
      }
    }

    // Update Selection Preview: show single-tile cursor when no drag is active
    // (during drag, the tool handler renders the drag selection rectangle)
    if (!state.dragState && state.tool !== 'select' && !(state.tool === 'asset' && state.pendingAsset)) {
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
      logger.error('Editor input error (up):', error);
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

      case 'terrain':
        this.handleTerrainTool(phase, tileX, tileY);
        break;

      case 'wall':
        this.handleWallTool(phase, tileX, tileY);
        break;

      case 'collision':
        this.handleCollisionTool(phase, tileX, tileY);
        break;

      default:
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

      this.renderer.renderSelection(
        {
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y1 - y0,
        },
        EditorInputHandler.TOOL_COLORS['zone'],
      );
    } else if (phase === 'up' && state.dragState) {
      EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX, tileY });
    }
  }

  private handleAssetTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (!state.pendingAsset) {
      return;
    }

    // Objects & structures: stamp mode (click to place, no drag)
    if (state.pendingAsset.category !== 'terrain') {
      if (phase === 'up') {
        EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });

        // Queue for DB persistence
        EditorService.dispatch({
          type: 'ADD_PENDING_OBJECT_CREATE',
          object: {
            id: -Date.now(),
            assetPackUuid: state.pendingAsset.packUuid || '',
            itemId: state.pendingAsset.itemId || '',
            category: state.pendingAsset.category || 'objects',
            tileX,
            tileY,
            width: state.pendingAsset.width || 16,
            height: state.pendingAsset.height || 16,
            collide: state.pendingAsset.collide || false,
            zIndex: 0,
            scaleFactor: state.pendingAsset.scaleFactor || 1,
            rotation: state.pendingAsset.rotation || 0,
            dataUrl: state.pendingAsset.dataUrl,
            _pending: 'add',
          },
        });
      }
      return;
    }

    // Terrain: drag logic (START_ASSET_DRAG → UPDATE_ASSET_DRAG → COMPLETE_ASSET_DRAG)
    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX, tileY });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_ASSET_DRAG', tileX, tileY });

      // Update Selection Preview for drag area
      const drag = state.dragState;
      const x0 = Math.min(drag.startTileX, tileX) * this.tileSize;
      const y0 = Math.min(drag.startTileY, tileY) * this.tileSize;
      const x1 = (Math.max(drag.startTileX, tileX) + 1) * this.tileSize;
      const y1 = (Math.max(drag.startTileY, tileY) + 1) * this.tileSize;

      this.renderer.renderSelection(
        {
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y1 - y0,
        },
        EditorInputHandler.TOOL_COLORS['terrain'],
      ); // Asset terrain drag uses blue
    } else if (phase === 'up' && state.dragState) {
      const drag = state.dragState;
      EditorService.dispatch({ type: 'COMPLETE_ASSET_DRAG', tileX, tileY });

      // Queue each tile in the drag rectangle for DB persistence
      const minX = Math.min(drag.startTileX, tileX);
      const minY = Math.min(drag.startTileY, tileY);
      const maxX = Math.max(drag.startTileX, tileX);
      const maxY = Math.max(drag.startTileY, tileY);

      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          EditorService.dispatch({
            type: 'ADD_PENDING_OBJECT_CREATE',
            object: {
              id: -(Date.now() + ty * 1000 + tx),
              assetPackUuid: state.pendingAsset.packUuid || '',
              itemId: state.pendingAsset.itemId || '',
              category: state.pendingAsset.category || 'terrain',
              tileX: tx,
              tileY: ty,
              width: state.pendingAsset.width || 16,
              height: state.pendingAsset.height || 16,
              collide: state.pendingAsset.collide || false,
              zIndex: 0,
              scaleFactor: state.pendingAsset.scaleFactor || 1,
              rotation: state.pendingAsset.rotation || 0,
              dataUrl: state.pendingAsset.dataUrl,
              _pending: 'add',
            },
          });
        }
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
    const cat = state.category;

    // Terrain / Autotiles / Collisions: drag-based erase via TILE_DRAG
    if (cat === 'terrain' || cat === 'autotiles' || cat === 'collisions') {
      if (phase === 'down') {
        EditorService.dispatch({ type: 'START_TILE_DRAG', tileX, tileY, mode: 'erase' });
      } else if (phase === 'move' && state.dragState) {
        EditorService.dispatch({ type: 'UPDATE_TILE_DRAG', tileX, tileY });
        this.renderDragSelection(state.dragState.startTileX, state.dragState.startTileY, tileX, tileY, 'erase');
      } else if (phase === 'up' && state.dragState) {
        EditorService.dispatch({ type: 'COMPLETE_TILE_DRAG', tileX, tileY });
      }
      return;
    }

    // Objects / Structures: single-click toggle mark-for-delete (unchanged)
    if (phase !== 'down') return;
    if (cat !== 'objects' && cat !== 'structures') return;

    const hit = [...state.mapObjects].reverse().find((o) => o.tileX === tileX && o.tileY === tileY);
    if (!hit) return;

    const alreadyMarked = state.pendingChanges.objectsToDelete.some((id) => String(id) === String(hit.id));

    if (alreadyMarked) {
      EditorService.dispatch({ type: 'REMOVE_PENDING_OBJECT_DELETE', objectId: hit.id });
    } else {
      EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: hit.id });
    }
  }

  private handleTerrainTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_TILE_DRAG', tileX, tileY, mode: 'terrain' });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_TILE_DRAG', tileX, tileY });
      this.renderDragSelection(state.dragState.startTileX, state.dragState.startTileY, tileX, tileY, 'terrain');
    } else if (phase === 'up' && state.dragState) {
      EditorService.dispatch({ type: 'COMPLETE_TILE_DRAG', tileX, tileY });
    }
  }

  private handleWallTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_TILE_DRAG', tileX, tileY, mode: 'wall' });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_TILE_DRAG', tileX, tileY });
      this.renderDragSelection(state.dragState.startTileX, state.dragState.startTileY, tileX, tileY, 'wall');
    } else if (phase === 'up' && state.dragState) {
      EditorService.dispatch({ type: 'COMPLETE_TILE_DRAG', tileX, tileY });
    }
  }

  private handleCollisionTool(phase: 'down' | 'move' | 'up', tileX: number, tileY: number): void {
    const state = EditorService.getState();

    if (phase === 'down') {
      EditorService.dispatch({ type: 'START_TILE_DRAG', tileX, tileY, mode: 'collision' });
    } else if (phase === 'move' && state.dragState) {
      EditorService.dispatch({ type: 'UPDATE_TILE_DRAG', tileX, tileY });
      this.renderDragSelection(state.dragState.startTileX, state.dragState.startTileY, tileX, tileY, 'collision');
    } else if (phase === 'up' && state.dragState) {
      EditorService.dispatch({ type: 'COMPLETE_TILE_DRAG', tileX, tileY });
    }
  }

  private renderDragSelection(
    startTileX: number,
    startTileY: number,
    endTileX: number,
    endTileY: number,
    tool: string,
  ): void {
    const x0 = Math.min(startTileX, endTileX) * this.tileSize;
    const y0 = Math.min(startTileY, endTileY) * this.tileSize;
    const x1 = (Math.max(startTileX, endTileX) + 1) * this.tileSize;
    const y1 = (Math.max(startTileY, endTileY) + 1) * this.tileSize;
    const color = EditorInputHandler.TOOL_COLORS[tool] ?? 0x3b82f6;

    this.renderer.renderSelection({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, color);
  }

  private setupKeyboardShortcuts(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = EditorService.getState();
      if (!state.active) return;

      // Ctrl/Cmd+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('editor:save'));
        return;
      }

      // Skip shortcuts when focused on form elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case '1':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'select' });
          break;
        case '2':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'terrain' });
          break;
        case '3':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'asset' });
          break;
        case '4':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'collision' });
          break;
        case '5':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' });
          break;
        case '6':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'spawn' });
          break;
        case '7':
          EditorService.dispatch({ type: 'SET_TOOL', tool: 'erase' });
          break;
        case 'g':
          EditorService.dispatch({ type: 'TOGGLE_GRID' });
          break;
        case 'c':
          EditorService.dispatch({ type: 'TOGGLE_VIEW', key: 'collision' });
          break;
        case 'Delete':
        case 'Backspace': {
          const selectedId = state.selectedObjectId;
          if (!selectedId) break;
          const obj = state.mapObjects.find((o) => String(o.id) === selectedId);
          if (obj) {
            EditorService.dispatch({ type: 'ADD_PENDING_OBJECT_DELETE', objectId: obj.id });
            EditorService.dispatch({ type: 'SELECT_MAP_OBJECT', objectId: null });
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    // Store reference for cleanup
    this.keydownHandler = onKeyDown;
  }

  private isSpaceHeld(): boolean {
    const spaceKey = this.scene.input.keyboard?.addKey('SPACE');
    return spaceKey?.isDown || false;
  }

  public destroy(): void {
    this.scene.input.off('pointerdown', this.boundHandlePointerDown);
    this.scene.input.off('pointermove', this.boundHandlePointerMove);
    this.scene.input.off('pointerup', this.boundHandlePointerUp);
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
  }
}
