import { describe, expect, it } from 'vitest';
import {
  assetCollisionFootprint,
  directionalAssets,
  buildAssets,
  themes,
  type AssetId,
  type ThemeId,
} from '../src/assets.ts';
import { packConfig } from '../src/pack.ts';

// Die reine Serverfunktion benötigt keine Datenbankverbindung. Der dynamische
// Import vermeidet eine Typprüfung des nicht generierten Prisma-Clients.
const serverModule = new URL('../../../apps/server/src/api/utils/collisionHelpers.ts', import.meta.url).pathname;
const { computeFootprintTiles } = (await import(serverModule)) as {
  computeFootprintTiles: (...args: number[]) => { cx: number; cy: number; rx: number; ry: number }[];
};

describe('Kollisionsvorgaben im echten Serverraster', () => {
  it('blockiert bei der Pflanze nur die unterste Kachelzeile', () => {
    const config = packConfig('holz', buildAssets('holz'));
    const plant = config.objects.find((item) => item.dataURL === 'assets/plant.png')!;
    const tiles = computeFootprintTiles(0, 0, plant.width, plant.height, 16, 16, 32, plant.collisionBaseHeight);
    expect(tiles).toEqual([
      { cx: 0, cy: 0, rx: 0, ry: 2 },
      { cx: 0, cy: 0, rx: 1, ry: 2 },
    ]);
  });

  for (const theme of Object.keys(themes) as ThemeId[]) {
    it(`${theme}: Vorschau entspricht den Server-Kacheln aller Bausteine`, () => {
      const assets = buildAssets(theme);
      const config = packConfig(theme, assets);
      for (const item of [...config.objects, ...config.structures]) {
        const id = item.dataURL.slice(7, -4) as AssetId;
        const foot = assetCollisionFootprint(id, assets[id]);
        expect(item.collide).toBe(foot !== null);
        expect(item.renderLayer).toBe('sorted');
        expect(item.placement).toBe(item.category === 'objects' ? 'floor' : 'wall');
        expect(item.rotationAllowed).toBe(Object.hasOwn(directionalAssets, id));
        expect(item.scaleFactor).toBe(1);
        if (!foot) continue;
        const tiles = computeFootprintTiles(31, 31, item.width, item.height, 16, 16, 32, item.collisionBaseHeight);
        const rendered = new Set<string>();
        for (let y = foot.y; y < foot.y + foot.h; y += 16)
          for (let x = foot.x; x < foot.x + foot.w; x += 16) rendered.add(`${x / 16},${y / 16}`);
        const server = new Set(tiles.map((tile) => `${tile.cx * 32 + tile.rx - 31},${tile.cy * 32 + tile.ry - 31}`));
        expect(rendered).toEqual(server);
      }
      for (const terrain of config.terrain) {
        expect(terrain.collide).toBe(false);
        expect(terrain.renderLayer).toBe('floor');
        expect(terrain.placement).toBe('floor');
      }
    });
  }
});
