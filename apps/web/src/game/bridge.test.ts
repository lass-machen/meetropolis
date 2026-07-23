import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gameBridge, type SceneApi } from './bridge';
import type { MovementLockReason } from '../types/game';

describe('gameBridge delegates to SceneApi', () => {
  it('delegates setZoneOverlay and setDesiredPosition', () => {
    const api: SceneApi = {
      syncRemotePlayers: vi.fn(),
      setDesiredPosition: vi.fn(),
      setZoneOverlay: vi.fn(),

      setSelectionRect: vi.fn(),
      applyTilePaint: vi.fn(),
      registerTileset: vi.fn(),
      setCollisionVisible: vi.fn(),
      reloadEditorLayers: vi.fn(),
      setBubbleMembers: vi.fn(),
    };
    gameBridge.setSceneApi(api);
    gameBridge.setDesiredPosition({ x: 1, y: 2 });
    gameBridge.setZoneOverlay([
      {
        name: 'Z',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]);
    expect(api.setDesiredPosition).toHaveBeenCalledOnce();
    // setZoneOverlay is called once for the explicit call and possibly once for setSceneApi (cache reapply)
    expect((api.setZoneOverlay as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('delegates applyTilePaint and registerTileset', () => {
    const api: SceneApi = {
      syncRemotePlayers: vi.fn(),
      setDesiredPosition: vi.fn(),
      setZoneOverlay: vi.fn(),

      setSelectionRect: vi.fn(),
      applyTilePaint: vi.fn(),
      registerTileset: vi.fn(),
      setCollisionVisible: vi.fn(),
      reloadEditorLayers: vi.fn(),
      setBubbleMembers: vi.fn(),
    };
    gameBridge.setSceneApi(api);
    gameBridge.applyTilePaint({
      layer: 'EditorGround',
      tilesetKey: 't',
      tileIndex: 1,
      rect: { startX: 0, startY: 0, endX: 1, endY: 1 },
    });
    gameBridge.registerTileset({ key: 'k', dataUrl: 'data:image/png;base64,AAA', tileWidth: 16, tileHeight: 16 });
    expect(api.applyTilePaint).toHaveBeenCalledOnce();
    expect(api.registerTileset).toHaveBeenCalledOnce();
  });
});

describe('gameBridge movement lock', () => {
  function makeApi(): SceneApi {
    return {
      syncRemotePlayers: vi.fn(),
      setDesiredPosition: vi.fn(),
      setZoneOverlay: vi.fn(),
      setSelectionRect: vi.fn(),
      applyTilePaint: vi.fn(),
      registerTileset: vi.fn(),
      setCollisionVisible: vi.fn(),
      reloadEditorLayers: vi.fn(),
      setBubbleMembers: vi.fn(),
      setMovementLocked: vi.fn(),
      setEditorMode: vi.fn(),
    };
  }

  // Typed so a future MovementLockReason cannot be forgotten here: the reason set
  // lives on the bridge module singleton and would otherwise leak between cases.
  const ALL_REASONS: MovementLockReason[] = ['dnd', 'bubble', 'editor'];

  beforeEach(() => {
    gameBridge.setSceneApi(null);
    for (const reason of ALL_REASONS) gameBridge.setMovementLocked(false, reason);
  });

  it('re-applies a lock that was set before any scene existed', () => {
    // The DND restore runs before the Phaser scene registers; without the cache
    // the lock would be swallowed and a restored DND would not freeze the player.
    gameBridge.setMovementLocked(true, 'dnd');

    const api = makeApi();
    gameBridge.setSceneApi(api);

    expect(api.setMovementLocked).toHaveBeenCalledWith(true);
  });

  it('re-applies the most recent value, not a stale lock', () => {
    gameBridge.setMovementLocked(true, 'dnd');
    gameBridge.setMovementLocked(false, 'dnd');

    const api = makeApi();
    gameBridge.setSceneApi(api);

    expect(api.setMovementLocked).toHaveBeenCalledWith(false);
  });

  it('still delegates directly once a scene is registered', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(true, 'dnd');

    expect(api.setMovementLocked).toHaveBeenCalledWith(true);
  });

  it('keeps the player locked while another reason is still active', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    gameBridge.setMovementLocked(true, 'dnd');
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(false, 'bubble');

    // Still locked, and nothing is pushed at all: an unlock would be wrong, and a
    // redundant re-push of true would clear desiredPos and abort click navigation.
    expect(api.setMovementLocked).not.toHaveBeenCalled();
  });

  it('ignores releasing a reason that was never set', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(false, 'bubble');

    expect(api.setMovementLocked).not.toHaveBeenCalled();
  });

  it('does not re-push when the same reason is set twice', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    gameBridge.setMovementLocked(true, 'dnd');
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(true, 'dnd');

    expect(api.setMovementLocked).not.toHaveBeenCalled();
  });

  it('does not unlock a dnd lock when the editor is left', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    gameBridge.setMovementLocked(true, 'dnd');
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setEditorMode(true);
    gameBridge.setEditorMode(false);

    expect(api.setMovementLocked).not.toHaveBeenCalledWith(false);
  });

  it('unlocks once every reason has been released', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    gameBridge.setMovementLocked(true, 'dnd');
    gameBridge.setMovementLocked(true, 'bubble');
    gameBridge.setEditorMode(true);
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(false, 'dnd');
    gameBridge.setMovementLocked(false, 'bubble');
    gameBridge.setEditorMode(false);

    expect(api.setMovementLocked).toHaveBeenLastCalledWith(false);
  });
  it('does not re-push a lock when one reason is released while another is held', () => {
    // playerManager.setMovementLocked(true) clears desiredPos, so a redundant
    // re-push would abort in-flight click navigation. Triggered in the wild by a
    // bubble_state broadcast that any other user on the map can cause.
    gameBridge.setMovementLocked(true, 'dnd');
    const api = makeApi();
    gameBridge.setSceneApi(api);
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(false, 'bubble');

    expect(api.setMovementLocked).not.toHaveBeenCalled();
  });

  it('still pushes a newly added reason while already locked (stop now)', () => {
    gameBridge.setMovementLocked(true, 'dnd');
    const api = makeApi();
    gameBridge.setSceneApi(api);
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(true, 'bubble');

    expect(api.setMovementLocked).toHaveBeenCalledWith(true);
  });

  it('unlocks only once the last reason is released', () => {
    const api = makeApi();
    gameBridge.setSceneApi(api);
    gameBridge.setMovementLocked(true, 'dnd');
    gameBridge.setMovementLocked(true, 'bubble');
    (api.setMovementLocked as ReturnType<typeof vi.fn>).mockClear();

    gameBridge.setMovementLocked(false, 'dnd');
    expect(api.setMovementLocked).not.toHaveBeenCalled();

    gameBridge.setMovementLocked(false, 'bubble');
    expect(api.setMovementLocked).toHaveBeenCalledWith(false);
  });
});
