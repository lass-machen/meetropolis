#!/usr/bin/env node
/**
 * Builds a combined spritesheet from individual businessman1 sprite files.
 * Output: apps/web/public/assets/sprites/default-avatars.png (64x192)
 *
 * Layout (4 cols x 8 rows, each cell 16x24):
 *   Row 0: idle_down  (1 frame, 3 transparent pads)
 *   Row 1: idle_left  (1 frame, 3 transparent pads)
 *   Row 2: idle_right (1 frame, 3 transparent pads)
 *   Row 3: idle_up    (1 frame, 3 transparent pads)
 *   Row 4: walk_down  (4 frames)
 *   Row 5: walk_left  (4 frames)
 *   Row 6: walk_right (4 frames)
 *   Row 7: walk_up    (4 frames)
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spritesDir = path.join(__dirname, '..', 'public', 'assets', 'sprites');

const FRAME_W = 16;
const FRAME_H = 24;
const COLS = 4;
const ROWS = 8;
const SHEET_W = COLS * FRAME_W;  // 64
const SHEET_H = ROWS * FRAME_H;  // 192

const rows = [
  { file: 'businessman1_idle_down.png',  frames: 1 },
  { file: 'businessman1_idle_left.png',  frames: 1 },
  { file: 'businessman1_idle_right.png', frames: 1 },
  { file: 'businessman1_idle_up.png',    frames: 1 },
  { file: 'businessman1_walk_down.png',  frames: 4 },
  { file: 'businessman1_walk_left.png',  frames: 4 },
  { file: 'businessman1_walk_right.png', frames: 4 },
  { file: 'businessman1_walk_up.png',    frames: 4 },
];

async function build() {
  const composites = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const { file, frames } = rows[rowIdx];
    const src = path.join(spritesDir, file);
    const buf = await sharp(src).ensureAlpha().raw().toBuffer();

    for (let f = 0; f < frames; f++) {
      // Extract single frame from source (frames are side by side)
      const frameBuf = Buffer.alloc(FRAME_W * FRAME_H * 4);
      for (let y = 0; y < FRAME_H; y++) {
        const srcOffset = (y * frames * FRAME_W + f * FRAME_W) * 4;
        const dstOffset = y * FRAME_W * 4;
        buf.copy(frameBuf, dstOffset, srcOffset, srcOffset + FRAME_W * 4);
      }

      composites.push({
        input: await sharp(frameBuf, { raw: { width: FRAME_W, height: FRAME_H, channels: 4 } }).png().toBuffer(),
        left: f * FRAME_W,
        top: rowIdx * FRAME_H,
      });
    }
  }

  const outPath = path.join(spritesDir, 'default-avatars.png');
  await sharp({
    create: { width: SHEET_W, height: SHEET_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(outPath);

  console.log(`Spritesheet written to ${outPath} (${SHEET_W}x${SHEET_H})`);
}

build().catch((err) => {
  console.error('Failed to build spritesheet:', err);
  process.exit(1);
});
