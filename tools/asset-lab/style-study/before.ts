// Before-state: real product geometry rendered by the unchanged shared
// composer (packages/shared/src/sprite) from the unchanged catalog at
// f28ee55. The static start frames are cut from column 0 of the idle rows:
// row 0 front, row 1 left, row 2 right, row 3 rear. No Python generator is
// involved; the before pixels are exactly what the product renders today.

import catalogData from '../../../packages/shared/sprite/catalog.json' with { type: 'json' };
import {
  assertSpriteCatalog,
  composeSheet,
  type AvatarConfig,
  type RgbaImage,
} from '../../../packages/shared/src/sprite/index.ts';
import type { Direction } from './figures.ts';

const catalog = assertSpriteCatalog(structuredClone(catalogData));

export const IDLE_ROW: Record<Direction, number> = {
  front: 0,
  left: 1,
  right: 2,
  rear: 3,
};

function cutFrame(sheet: RgbaImage, row: number): RgbaImage {
  const size = 32;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((row * size + y) * sheet.width + x) * 4;
      const dst = (y * size + x) * 4;
      data[dst] = sheet.data[src];
      data[dst + 1] = sheet.data[src + 1];
      data[dst + 2] = sheet.data[src + 2];
      data[dst + 3] = sheet.data[src + 3];
    }
  }
  return { width: size, height: size, data };
}

export interface BeforeRecipe {
  skin: string;
  hair: string;
  hairColor: string;
}

// Same recipe colors and clothing as the after-state figures.
export function beforeFrame(recipe: BeforeRecipe, direction: Direction): RgbaImage {
  const config: AvatarConfig = {
    skin: recipe.skin,
    hair: recipe.hair,
    hair_color: recipe.hairColor,
    outfit: 'trousers',
    top: 'hoodie_blue',
    pants: 'dark',
    shoes: 'brown',
    beard: null,
    beard_color: recipe.hairColor,
    glasses: null,
    hat: null,
    misc: null,
    face: 'ruhig',
    proportion: 'kompakt',
  };
  const sheet = composeSheet(catalog, config);
  if (sheet.width !== 128 || sheet.height !== 256) throw new Error('unexpected sheet size');
  return cutFrame(sheet, IDLE_ROW[direction]);
}
