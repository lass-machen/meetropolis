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
    // v2: Tileset-Images werden dynamisch anhand Registry geladen
    // Fallback: v1 TMJ nur, wenn v2 nicht verfügbar
    // Relativer Pfad für Electron-Kompatibilität (kein führender Slash)
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

    // Erzeuge gepaddete office_tiles (192x48), wie in Tiled definiert
    const src = this.textures.get('office_tiles_raw')?.getSourceImage() as HTMLImageElement | undefined;
    if (src) {
      const targetW = 192; // 12 cols * 16px
      const targetH = 48;  // 3 rows * 16px
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
    (async () => {
      try {
        const mapName = useMapStore.getState().currentMapName || 'office';
        const state = await fetchStateV2(mapName);
        const metaOk = !!(state && state.mapMeta && state.mapMeta.width && state.mapMeta.height && state.mapMeta.tileWidth && state.mapMeta.tileHeight);
        if (metaOk) {
          // Tileset-Images für Registry laden (Schlüssel = key)
          await preloadTilesetImages(this, state!.tilesetRegistry);
          (window as any).__v2_state = state;
          this.scene.start('Main');
        } else {
          logger.error('[Boot] Invalid V2 state received');
        }
      } catch (e) {
        logger.error('[Boot] Failed to load V2 state', e);
      }
    })();
  }
}
