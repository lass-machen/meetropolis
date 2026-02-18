import { useMapStore } from '../../state/mapStore';
import { fetchStateV2, preloadTilesetImages } from '../../lib/mapV2';
import { gameBridge } from '../bridge';
import { logger } from '../../lib/logger';

export async function changeMap(targetMapName: string, room: { send: (type: string, data: unknown) => void; onMessage: (type: string, handler: (data: unknown) => void) => void }): Promise<void> {
  const store = useMapStore.getState();

  if (store.isChangingMap) {
    logger.warn('[changeMap] Already changing map, ignoring');
    return;
  }

  if (targetMapName === store.currentMapName) {
    logger.debug('[changeMap] Already on target map:', targetMapName);
    return;
  }

  store.setIsChangingMap(true);

  try {
    // 1. Tell server to change map
    room.send('change_map', { mapName: targetMapName });

    // 2. Wait for server confirmation
    const confirmed = await new Promise<{ mapName: string; x: number; y: number } | null>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 5000);

      room.onMessage('map_changed', (data: unknown) => {
        clearTimeout(timeout);
        resolve(data as { mapName: string; x: number; y: number });
      });
    });

    if (!confirmed) {
      throw new Error('Map change timed out');
    }

    // 3. Fetch new map state
    const newState = await fetchStateV2(targetMapName);
    if (!newState || !newState.mapMeta?.width || !newState.mapMeta?.height) {
      throw new Error('Failed to load map state for: ' + targetMapName);
    }

    // 4. Get Phaser game instance and stop MainScene
    const anyWin = window as unknown as Record<string, unknown>;
    const game = anyWin.__phaser_game as Phaser.Game | undefined;
    if (!game) throw new Error('Phaser game not found');

    game.scene.stop('Main');

    // 5. Update v2 state
    anyWin.__v2_state = newState;

    // 6. Preload tileset images in BootScene
    const bootScene = game.scene.getScene('Boot');
    if (bootScene) {
      await preloadTilesetImages(bootScene, newState.tilesetRegistry);
    }

    // 7. Clear remote players cache
    gameBridge.syncRemotePlayers({});

    // 8. Restart MainScene
    game.scene.start('Main');

    // 9. Update store
    store.setCurrentMapName(targetMapName);

    logger.info('[changeMap] Successfully changed to map:', targetMapName);
  } catch (e) {
    logger.error('[changeMap] Failed to change map:', e);
  } finally {
    store.setIsChangingMap(false);
  }
}
