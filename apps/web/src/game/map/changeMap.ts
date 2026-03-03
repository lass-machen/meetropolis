import { useMapStore } from '../../state/mapStore';
import { fetchStateV2, preloadTilesetImages } from '../../lib/mapV2';
import { gameBridge } from '../bridge';
import { logger } from '../../lib/logger';
import { EditorService } from '../../services/EditorService';

export async function changeMap(targetMapId: string, targetMapName: string, room: { send: (type: string, data: unknown) => void; onMessage: (type: string, handler: (data: unknown) => void) => (() => void) }, spawnOverride?: { x: number; y: number }): Promise<void> {
  const store = useMapStore.getState();

  if (store.isChangingMap) {
    logger.warn('[changeMap] Already changing map, ignoring');
    return;
  }

  if (targetMapId === store.currentMapId) {
    logger.debug('[changeMap] Already on target map:', targetMapId);
    return;
  }

  store.setIsChangingMap(true);

  try {
    // 1. Tell server to change map
    room.send('change_map', { mapId: targetMapId, ...(spawnOverride ? { spawnX: spawnOverride.x, spawnY: spawnOverride.y } : {}) });

    // 2. Wait for server confirmation
    const confirmed = await new Promise<{ mapName: string; x: number; y: number } | null>((resolve) => {
      const timeout = setTimeout(() => {
        removeHandler();
        resolve(null);
      }, 5000);

      const removeHandler = room.onMessage('map_changed', (data: unknown) => {
        clearTimeout(timeout);
        removeHandler();
        resolve(data as { mapName: string; x: number; y: number });
      });
    });

    if (!confirmed) {
      throw new Error('Map change timed out');
    }

    // 3. Update store EARLY so any Colyseus onStateChange callbacks
    //    that fire during async operations filter players by the new map.
    const prevMapId = store.currentMapId;
    const prevMapName = store.currentMapName;
    store.setCurrentMap(targetMapId, targetMapName);

    let newState: Awaited<ReturnType<typeof fetchStateV2>>;
    try {
      // 4. Fetch new map state
      newState = await fetchStateV2(targetMapId);
    } catch (e) {
      // Revert store on fetch failure
      store.setCurrentMap(prevMapId, prevMapName);
      throw e;
    }
    if (!newState || !newState.mapMeta?.width || !newState.mapMeta?.height) {
      store.setCurrentMap(prevMapId, prevMapName);
      throw new Error('Failed to load map state for: ' + targetMapId);
    }

    // 5. Get Phaser game instance and stop MainScene
    const anyWin = window as unknown as Record<string, unknown>;
    const game = anyWin.__PHASER_GAME__ as Phaser.Game | undefined;
    if (!game) {
      store.setCurrentMap(prevMapId, prevMapName);
      throw new Error('Phaser game not found');
    }

    // Clear stale state from previous map
    gameBridge.setZoneOverlay([]);
    EditorService.reset();

    game.scene.stop('Main');

    // 6. Update v2 state
    anyWin.__v2_state = newState;

    // 7. Preload tileset images in BootScene
    const bootScene = game.scene.getScene('Boot');
    if (bootScene) {
      await preloadTilesetImages(bootScene, newState.tilesetRegistry);
    }

    // 8. Set confirmed spawn position BEFORE restarting scene
    (window as any).initialPlayerPosition = { x: confirmed.x, y: confirmed.y };

    // 9. Restart MainScene
    // NOTE: Remote players cache is NOT cleared here. The Colyseus onStateChange
    // callback populates the cache with correct players for the new map during
    // the async operations above. The old scene is already stopped (sceneApi=null),
    // so stale players cannot be displayed. When the new scene starts and calls
    // setSceneApi(this), it restores from the correctly populated cache, creating
    // sprites AND name labels for all players on the new map.
    game.scene.start('Main');

    // Notify React to reload zones for the new map
    window.dispatchEvent(new CustomEvent('map_zones_reload', { detail: { mapId: targetMapId, mapName: targetMapName } }));

    // Immediately persist map change to server
    try {
      const apiBase = (window as any).desktop?.apiBase || (window as any).__MEETROPOLIS_API_BASE__ || (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const payload = JSON.stringify({
        x: Math.round(confirmed.x),
        y: Math.round(confirmed.y),
        direction: 'down',
        mapName: targetMapName,
      });
      fetch(`${apiBase}/auth/position`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore persistence errors */ }

    logger.info('[changeMap] Successfully changed to map:', targetMapName);
  } catch (e) {
    logger.error('[changeMap] Failed to change map:', e);
  } finally {
    store.setIsChangingMap(false);
  }
}
