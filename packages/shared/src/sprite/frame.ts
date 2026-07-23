// Single-frame pixel operations, mirroring engine.render_frame's blit and
// engine.flip_image. A frame is a row-major RGBA byte buffer (4 bytes/pixel).

import type { Grid, Rgba } from './types.js';

/** Allocate a transparent (all-zero) RGBA frame buffer. */
export function makeFrame(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

/**
 * Paint one grid onto a frame at offset (dx, dy). Matches engine.render_frame:
 * transparent source pixels (`'.'`) are SKIPPED (never clear what is under
 * them), non-transparent pixels HARD-REPLACE (no alpha blend), and out-of-frame
 * pixels are clipped. An unknown slot char is a loud failure, as in Python.
 */
export function blitGrid(
  frame: Uint8ClampedArray,
  width: number,
  height: number,
  grid: Grid,
  dx: number,
  dy: number,
  palette: ReadonlyMap<string, Rgba>,
): void {
  for (let y = 0; y < grid.length; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch === '.') continue;
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      const color = palette.get(ch);
      if (color === undefined) throw new Error(`no palette colour for slot '${ch}'`);
      const idx = (ny * width + nx) * 4;
      frame[idx] = color[0];
      frame[idx + 1] = color[1];
      frame[idx + 2] = color[2];
      frame[idx + 3] = color[3];
    }
  }
}

/** Mirror a frame horizontally (left-facing view -> right-facing). */
export function mirrorFrame(frame: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = makeFrame(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (y * width + (width - 1 - x)) * 4;
      out[dst] = frame[src];
      out[dst + 1] = frame[src + 1];
      out[dst + 2] = frame[src + 2];
      out[dst + 3] = frame[src + 3];
    }
  }
  return out;
}
