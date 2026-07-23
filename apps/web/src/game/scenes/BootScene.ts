import Phaser from 'phaser';
import { fetchStateV2, preloadTilesetImages } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import { avatarRegistry } from '../avatarRegistry';
import { useMapStore } from '../../state/mapStore';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // v2: tileset images are loaded dynamically based on the registry.
    // We preload the three built-in office sheets so the Phaser cache is
    // primed before MainScene asks for them; the v2 registry preloader
    // (preloadTilesetImages) is a no-op for keys that already exist.
    // Use a relative path for Electron compatibility (no leading slash).
    this.load.image('office_floor', 'assets/tilesets/office_floor.png');
    this.load.image('office_wall', 'assets/tilesets/office_wall.png');
    this.load.image('collision', 'assets/tilesets/collision.png');

    // Avatar system: load avatar spritesheets
    avatarRegistry.ensureDefault();
    const avatarId = localStorage.getItem('avatarId') || avatarRegistry.getDefaultAvatarId();
    avatarRegistry.preloadAvatar(this, avatarId);
    if (avatarId !== avatarRegistry.getDefaultAvatarId()) {
      avatarRegistry.preloadAvatar(this, avatarRegistry.getDefaultAvatarId());
    }
  }

  create() {
    // Create avatar animations
    const avatarId = localStorage.getItem('avatarId') || avatarRegistry.getDefaultAvatarId();
    avatarRegistry.createAnimations(this.anims, avatarId);
    avatarRegistry.createAnimations(this.anims, avatarRegistry.getDefaultAvatarId());

    // v2 Boot: prefetch state-v2
    void (async () => {
      try {
        // Returns true once MainScene has been started. A false result means
        // the id did not resolve to a valid map for this tenant (e.g. a
        // stale/cross-tenant currentMapId persisted in localStorage that 404s);
        // the caller then waits for the store to reconcile a valid id.
        const loadMap = async (id: string): Promise<boolean> => {
          const state = await fetchStateV2(id);
          const metaOk = !!(
            state &&
            state.mapMeta &&
            state.mapMeta.width &&
            state.mapMeta.height &&
            state.mapMeta.tileWidth &&
            state.mapMeta.tileHeight
          );
          if (!metaOk) {
            logger.error('[Boot] Invalid V2 state received for map', id);
            return false;
          }
          await preloadTilesetImages(this, state.tilesetRegistry);
          window.__v2_state = state;
          this.scene.start('Main');
          return true;
        };

        const initialId = useMapStore.getState().currentMapId;
        if (initialId && (await loadMap(initialId))) return;

        // Either no id yet, or the persisted id was stale/cross-tenant and
        // failed. Wait for the store to resolve a *different*, valid
        // currentMapId (setAvailableMaps reconciles it against the tenant's
        // maps) and retry, instead of giving up on the first failure.
        logger.debug('[Boot] Waiting for a valid currentMapId...');
        await new Promise<void>((resolve) => {
          let settled = false;
          // In-flight guard: the subscription fires on every store change, so
          // without it a second change while loadMap is pending would kick off
          // a concurrent loadMap and a double scene.start('Main').
          let loading = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          };
          const timeout = setTimeout(() => {
            logger.error('[Boot] No valid map after 10s, cannot load map');
            finish();
          }, 10_000);
          const unsubscribe = useMapStore.subscribe((state) => {
            if (settled || loading || !state.currentMapId || state.currentMapId === initialId) return;
            loading = true;
            loadMap(state.currentMapId)
              .then((ok) => {
                if (ok) finish();
                else loading = false; // allow a retry on the next valid id
              })
              .catch((e) => {
                loading = false;
                logger.error('[Boot] Retry load failed', e);
              });
          });
        });
      } catch (e) {
        logger.error('[Boot] Failed to load V2 state', e);
      }
    })();
  }
}
