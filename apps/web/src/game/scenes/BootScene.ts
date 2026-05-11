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
    // Fallback: v1 TMJ only when v2 is unavailable.
    // Use a relative path for Electron compatibility (no leading slash).
    this.load.image('office_tiles_raw', 'assets/tilesets/office_tiles.png');
    this.load.image('furniture_tiles', 'assets/tilesets/furniture_tiles.png');
    this.load.image('decor_tiles', 'assets/tilesets/decor_tiles.png');

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

    // Create padded office_tiles (192x48) as defined in Tiled
    const src = this.textures.get('office_tiles_raw')?.getSourceImage() as HTMLImageElement | undefined;
    if (src) {
      const targetW = 192; // 12 cols * 16px
      const targetH = 48; // 3 rows * 16px
      const ctex = this.textures.createCanvas('office_tiles', targetW, targetH);
      if (ctex) {
        const ctx = ctex.getContext();
        if (ctx) {
          ctx.clearRect(0, 0, targetW, targetH);
          ctx.drawImage(src, 0, 0);
        }
        ctex.refresh();
      }
    }

    // Always create collision tiles as canvas
    const ctex = this.textures.createCanvas('collision_tiles', 256, 48); // 16x3 tiles
    if (ctex) {
      const ctx = ctex.getContext();
      if (ctx) {
        ctx.fillStyle = 'rgba(255,0,0,0.5)';
        // Draw a 3x3 grid of collision tiles
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 16; x++) {
            ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
          }
        }
      }
      ctex.refresh();
    }

    // v2 Boot: prefetch state-v2
    void (async () => {
      try {
        const loadMap = async (id: string) => {
          const state = await fetchStateV2(id);
          const metaOk = !!(
            state &&
            state.mapMeta &&
            state.mapMeta.width &&
            state.mapMeta.height &&
            state.mapMeta.tileWidth &&
            state.mapMeta.tileHeight
          );
          if (metaOk) {
            await preloadTilesetImages(this, state.tilesetRegistry);
            window.__v2_state = state;
            this.scene.start('Main');
          } else {
            logger.error('[Boot] Invalid V2 state received');
          }
        };

        const mapId = useMapStore.getState().currentMapId;
        if (mapId) {
          await loadMap(mapId);
        } else {
          // Wait for mapStore to resolve currentMapId (race with setAvailableMaps / full_state)
          logger.debug('[Boot] Waiting for currentMapId...');
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              unsubscribe();
              logger.error('[Boot] No currentMapId after 10s, cannot load map');
              resolve();
            }, 10_000);
            const unsubscribe = useMapStore.subscribe((state) => {
              if (state.currentMapId) {
                clearTimeout(timeout);
                unsubscribe();
                loadMap(state.currentMapId)
                  .then(resolve)
                  .catch(() => {
                    logger.error('[Boot] Failed to load map after waiting');
                    resolve();
                  });
              }
            });
          });
        }
      } catch (e) {
        logger.error('[Boot] Failed to load V2 state', e);
      }
    })();
  }
}
