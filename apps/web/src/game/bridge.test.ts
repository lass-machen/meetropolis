import { describe, it, expect, vi } from 'vitest';
import { gameBridge, type SceneApi } from './bridge';

describe('gameBridge delegiert an SceneApi', () => {
  it('delegiert setZoneOverlay und setDesiredPosition', () => {
    const api: SceneApi = {
      syncRemotePlayers: vi.fn(),
      setDesiredPosition: vi.fn(),
      setZoneOverlay: vi.fn(),
      setEditorAssets: vi.fn(),
      setSelectionRect: vi.fn(),
      applyTilePaint: vi.fn(),
      registerTileset: vi.fn(),
    };
    gameBridge.setSceneApi(api);
    gameBridge.setDesiredPosition({ x: 1, y: 2 });
    gameBridge.setZoneOverlay([{ name: 'Z', points: [{x:0,y:0},{x:1,y:0},{x:1,y:1}] } as any]);
    expect(api.setDesiredPosition).toHaveBeenCalledOnce();
    expect(api.setZoneOverlay).toHaveBeenCalledOnce();
  });

  it('delegiert applyTilePaint und registerTileset', () => {
    const api: SceneApi = {
      syncRemotePlayers: vi.fn(),
      setDesiredPosition: vi.fn(),
      setZoneOverlay: vi.fn(),
      setEditorAssets: vi.fn(),
      setSelectionRect: vi.fn(),
      applyTilePaint: vi.fn(),
      registerTileset: vi.fn(),
    };
    gameBridge.setSceneApi(api);
    gameBridge.applyTilePaint({ layer: 'EditorGround', tilesetKey: 't', tileIndex: 1, rect: { startX: 0, startY: 0, endX: 1, endY: 1 } });
    gameBridge.registerTileset({ key: 'k', dataUrl: 'data:image/png;base64,AAA', tileWidth: 16, tileHeight: 16 });
    expect(api.applyTilePaint).toHaveBeenCalledOnce();
    expect(api.registerTileset).toHaveBeenCalledOnce();
  });
});


