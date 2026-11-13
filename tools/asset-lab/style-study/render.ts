// Pixel renderer: source grids to RGBA/PNG, plus integer nearest-neighbor
// scaling for the 4x sheet views. PNG encoding uses the repo's pngjs.

import { PNG } from 'pngjs';
import type { FigurePalette } from './palette.ts';

export function gridToRgba(grid: string[], palette: FigurePalette): Uint8ClampedArray {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const symbol = grid[y][x];
      if (symbol === '.') continue;
      const hex = (palette as Record<string, string>)[symbol];
      if (!hex) throw new Error(`no palette color for symbol '${symbol}'`);
      const n = Number.parseInt(hex.replace('#', ''), 16);
      const idx = (y * 32 + x) * 4;
      data[idx] = (n >> 16) & 255;
      data[idx + 1] = (n >> 8) & 255;
      data[idx + 2] = n & 255;
      data[idx + 3] = 255;
    }
  }
  return data;
}

export function encodePng(width: number, height: number, data: Uint8ClampedArray): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png);
}

// Integer scale-up without blending: one source pixel becomes a scale x
// scale block, so the sheet stays crisp under image-rendering: pixelated.
export function scaleUp(data: Uint8ClampedArray, width: number, height: number, scale: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * scale * (height * scale) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const dst = ((y * scale + dy) * width * scale + (x * scale + dx)) * 4;
          out[dst] = data[src];
          out[dst + 1] = data[src + 1];
          out[dst + 2] = data[src + 2];
          out[dst + 3] = data[src + 3];
        }
      }
    }
  }
  return out;
}
