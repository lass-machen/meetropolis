// Scale strip: one sprite pixel equals one world pixel. A 16px world grid
// with the stand line (the study signature) carries one after-figure plus
// two unchanged MIT stock furniture pieces, all bottom-aligned:
// - desk: tools/asset-lab/src/assets.ts, desk(), 64x48, theme holz
// - chair: tools/asset-lab/src/assets.ts, chair(), 24x32, theme holz
// The strip proves the figure reads at world scale next to real furniture.

import { assetDefinitions, themes } from '../src/assets.ts';
import { Pixels } from '../src/pixels.ts';

export const WORLD_GRID = 16;
export const DESK_SOURCE = 'tools/asset-lab/src/assets.ts (desk, 64x48, Thema holz)';
export const CHAIR_SOURCE = 'tools/asset-lab/src/assets.ts (chair, 24x32, Thema holz)';

export interface StripLayout {
  width: number;
  height: number;
  baselineY: number;
  figureX: number;
  deskX: number;
  chairX: number;
}

export function stripLayout(): StripLayout {
  const width = 192;
  const height = 80;
  const baselineY = 64;
  return { width, height, baselineY, figureX: 16, deskX: 64, chairX: 144 };
}

function blitOpaque(target: Pixels, source: Pixels, ox: number, oy: number): void {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const si = (y * source.width + x) * 4;
      if (source.data[si + 3] === 0) continue;
      const di = ((oy + y) * target.width + (ox + x)) * 4;
      target.data[di] = source.data[si];
      target.data[di + 1] = source.data[si + 1];
      target.data[di + 2] = source.data[si + 2];
      target.data[di + 3] = source.data[si + 3];
    }
  }
}

function blitRgba(target: Pixels, data: Uint8ClampedArray, width: number, height: number, ox: number, oy: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      if (data[si + 3] === 0) continue;
      const di = ((oy + y) * target.width + (ox + x)) * 4;
      target.data[di] = data[si];
      target.data[di + 1] = data[si + 1];
      target.data[di + 2] = data[si + 2];
      target.data[di + 3] = data[si + 3];
    }
  }
}

// Figure RGBA is 32x32; desk and chair are rendered by the unchanged
// asset-lab draws. Everything stands on the same baseline.
export function buildScaleStrip(figureRgba: Uint8ClampedArray): { layout: StripLayout; pixels: Pixels } {
  const layout = stripLayout();
  const strip = new Pixels(layout.width, layout.height);
  const gridColor = '#8a8478';
  const standColor = '#403548';
  for (let gx = 0; gx < layout.width; gx += WORLD_GRID) {
    strip.rect(gx, 0, 1, layout.height, gridColor);
  }
  for (let gy = 0; gy <= layout.height; gy += WORLD_GRID) {
    strip.rect(0, gy, layout.width, 1, gridColor);
  }
  const desk = assetDefinitions.desk.draw(themes.holz);
  const chair = assetDefinitions.chair.draw(themes.holz);
  if (desk.width !== 64 || desk.height !== 48) throw new Error('desk size changed');
  if (chair.width !== 24 || chair.height !== 32) throw new Error('chair size changed');
  // The shoe pixels sit at sprite row y29, so the canvas top goes to
  // baselineY - 30: sole y29 lands exactly on baselineY - 1, directly
  // above the stand line, with no 2px gap.
  blitRgba(strip, figureRgba, 32, 32, layout.figureX, layout.baselineY - 30);
  blitOpaque(strip, desk, layout.deskX, layout.baselineY - desk.height);
  blitOpaque(strip, chair, layout.chairX, layout.baselineY - chair.height);
  strip.rect(0, layout.baselineY, layout.width, 1, standColor);
  return { layout, pixels: strip };
}
