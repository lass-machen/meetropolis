/**
 * EditorService Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorService } from './EditorService';

describe('EditorService', () => {
  beforeEach(() => {
    // Reset service before each test
    EditorService.reset();
  });

  describe('Activation', () => {
    it('should start inactive', () => {
      const state = EditorService.getState();
      expect(state.active).toBe(false);
    });

    it('should activate editor', () => {
      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      const state = EditorService.getState();
      expect(state.active).toBe(true);
    });

    it('should deactivate editor', () => {
      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
      const state = EditorService.getState();
      expect(state.active).toBe(false);
    });
  });

  describe('Tools', () => {
    it('should set tool', () => {
      EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' });
      const state = EditorService.getState();
      expect(state.tool).toBe('zone');
    });

    it('should clear drag state when changing tool', () => {
      EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX: 0, tileY: 0 });
      expect(EditorService.getState().dragState).not.toBeNull();

      EditorService.dispatch({ type: 'SET_TOOL', tool: 'select' });
      expect(EditorService.getState().dragState).toBeNull();
    });
  });

  describe('Zones', () => {
    it('should create zone', () => {
      EditorService.dispatch({ type: 'SET_ZONE_NAME', name: 'TestZone' });
      EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX: 0, tileY: 0 });
      EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX: 5, tileY: 5 });

      const state = EditorService.getState();
      expect(state.zones).toHaveLength(1);
      expect(state.zones[0].name).toBe('TestZone');
      expect(state.zones[0].points).toHaveLength(4);
    });

    it('should delete zone', () => {
      EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX: 0, tileY: 0 });
      EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX: 5, tileY: 5 });

      expect(EditorService.getState().zones).toHaveLength(1);

      EditorService.dispatch({ type: 'DELETE_ZONE', index: 0 });
      expect(EditorService.getState().zones).toHaveLength(0);
    });

    it('should update zone name', () => {
      EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX: 0, tileY: 0 });
      EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX: 5, tileY: 5, name: 'Old' });

      EditorService.dispatch({ type: 'UPDATE_ZONE_NAME', index: 0, name: 'New' });

      const state = EditorService.getState();
      expect(state.zones[0].name).toBe('New');
    });

    it('should throw on invalid zone index', () => {
      expect(() => {
        EditorService.dispatch({ type: 'DELETE_ZONE', index: 99 });
      }).not.toThrow(); // Delete non-existent zones should be no-op

      expect(() => {
        EditorService.dispatch({ type: 'UPDATE_ZONE_NAME', index: 99, name: 'Test' });
      }).toThrow();
    });
  });

  describe('Assets', () => {
    it('should select asset', () => {
      const asset = {
        packUuid: 'test',
        itemId: '1',
        key: 'test-1',
        category: 'objects' as const,
        dataUrl: 'data:image/png;base64,test',
        width: 32,
        height: 32,
        collide: false,
      };

      EditorService.dispatch({ type: 'SELECT_ASSET', asset });

      const state = EditorService.getState();
      expect(state.pendingAsset).not.toBeNull();
      expect(state.pendingAsset?.key).toBe('test-1');
    });

    it('should place asset', () => {
      const asset = {
        packUuid: 'test',
        itemId: '1',
        key: 'test-1',
        category: 'objects' as const,
        dataUrl: 'data:image/png;base64,test',
        width: 32,
        height: 32,
        collide: false,
      };

      EditorService.dispatch({ type: 'SELECT_ASSET', asset });
      EditorService.dispatch({ type: 'PLACE_ASSET', tileX: 5, tileY: 5 });

      const state = EditorService.getState();
      expect(state.assets).toHaveLength(1);
      expect(state.assets[0].key).toBe('test-1');
    });

    it('should delete asset', () => {
      const asset = {
        packUuid: 'test',
        itemId: '1',
        key: 'test-1',
        category: 'objects' as const,
        dataUrl: 'data:image/png;base64,test',
        width: 32,
        height: 32,
        collide: false,
      };

      EditorService.dispatch({ type: 'SELECT_ASSET', asset });
      EditorService.dispatch({ type: 'PLACE_ASSET', tileX: 5, tileY: 5 });

      const id = EditorService.getState().assets[0].id;

      EditorService.dispatch({ type: 'DELETE_ASSET', id });
      expect(EditorService.getState().assets).toHaveLength(0);
    });

    it('should throw when placing without selection', () => {
      expect(() => {
        EditorService.dispatch({ type: 'PLACE_ASSET', tileX: 5, tileY: 5 });
      }).toThrow();
    });
  });

  describe('Spawn', () => {
    it('should set spawn', () => {
      EditorService.dispatch({ type: 'SET_SPAWN', x: 168, y: 168 });

      const state = EditorService.getState();
      expect(state.spawn).not.toBeNull();
      expect(state.spawn?.x).toBe(168); // 10 * 16 + 8
      expect(state.spawn?.y).toBe(168);
    });

    it('should clear spawn', () => {
      EditorService.dispatch({ type: 'SET_SPAWN', x: 168, y: 168 });
      EditorService.dispatch({ type: 'CLEAR_SPAWN' });

      expect(EditorService.getState().spawn).toBeNull();
    });
  });

  describe('Observers', () => {
    it('should notify subscribers on state change', () => {
      let callCount = 0;
      const unsubscribe = EditorService.subscribe(() => {
        callCount++;
      });

      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
      expect(callCount).toBe(1);

      EditorService.dispatch({ type: 'SET_TOOL', tool: 'zone' });
      expect(callCount).toBe(2);

      unsubscribe();

      EditorService.dispatch({ type: 'SET_TOOL', tool: 'asset' });
      expect(callCount).toBe(2); // Should not increase after unsubscribe
    });

    it('should provide current state to subscribers', () => {
      let receivedState: any = null;

      EditorService.subscribe((state) => {
        receivedState = state;
      });

      EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });

      expect(receivedState).not.toBeNull();
      expect(receivedState.active).toBe(true);
    });
  });

  describe('Background Color', () => {
    it('should set background color', () => {
      EditorService.dispatch({ type: 'SET_BACKGROUND_COLOR', color: '#ff0000' });
      expect(EditorService.getState().backgroundColor).toBe('#ff0000');
    });
  });

  describe('State Loading', () => {
    it('should load partial state', () => {
      EditorService.dispatch({
        type: 'LOAD_STATE',
        state: {
          zones: [{ name: 'Loaded', points: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }] }],
          backgroundColor: '#123456',
        },
      });

      const state = EditorService.getState();
      expect(state.zones).toHaveLength(1);
      expect(state.zones[0].name).toBe('Loaded');
      expect(state.backgroundColor).toBe('#123456');
    });
  });
});

