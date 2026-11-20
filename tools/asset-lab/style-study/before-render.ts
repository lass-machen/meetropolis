// Before-render helper: runs under tsx (not plain node strip-types),
// because the shared composer uses .js import specifiers that only a
// TypeScript-aware loader resolves. Renders the 16 before-frames with the
// unchanged shared composer and writes the PNGs plus a JSON extent report
// to stdout for generate.ts.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeFrame } from './before.ts';
import { DIRECTIONS, FIGURES } from './figures.ts';
import { encodePng } from './render.ts';

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--out-dir');
  const outDir = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!outDir || outDir.startsWith('--')) {
    console.error('usage: before-render.ts --out-dir <dir>');
    process.exit(2);
  }
  await mkdir(outDir, { recursive: true });
  const frames = [];
  for (const figure of FIGURES) {
    for (const dir of DIRECTIONS) {
      const frame = beforeFrame(figure, dir);
      let minY = 32;
      let maxY = -1;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (frame.data[(y * 32 + x) * 4 + 3] !== 0) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const name = `${figure.id}_${dir}_before.png`;
      await writeFile(join(outDir, name), encodePng(32, 32, frame.data));
      frames.push({ name, minY, maxY, empty: maxY < 0 });
    }
  }
  console.log(JSON.stringify({ frames }));
}

await main();
