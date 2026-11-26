// Style-study generator: builds the local sheet (style.html + out/style/)
// and runs the acceptance checks. Only writes below --preview-dir; the
// PNG and HTML stay local and are never committed.
//
// Acceptance: 4 figures x 4 views, every after-grid is 32x32, uses only
// valid palette symbols, keeps opaque pixels inside y4..y29, reaches the
// floor pixel at y29 and never clips at the canvas edge.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeAfter, DIRECTIONS, FIGURES, type Direction } from './figures.ts';
import { figurePalette, isSymbol, SKIN_TONES } from './palette.ts';
import { encodePng, gridToRgba } from './render.ts';
import { buildScaleStrip } from './scale.ts';
import { buildHtml } from './template.ts';

const GRID = 32;
const TOP = 4;
const BOTTOM = 29;

interface Failure {
  where: string;
  message: string;
}

function checkGrid(recipeId: string, dir: Direction, grid: string[], failures: Failure[]): void {
  const where = `${recipeId}/${dir}`;
  if (grid.length !== GRID) {
    failures.push({ where, message: `expected 32 rows, got ${grid.length}` });
    return;
  }
  let floor = false;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    if (row.length !== GRID) {
      failures.push({ where, message: `row ${y} is ${row.length} chars` });
      continue;
    }
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === '.') continue;
      if (!isSymbol(cell)) {
        failures.push({ where, message: `invalid symbol '${cell}' at ${x},${y}` });
        continue;
      }
      if (y < TOP || y > BOTTOM) {
        failures.push({ where, message: `out-of-range pixel at ${x},${y}` });
      }
      if (y === BOTTOM) floor = true;
    }
  }
  if (!floor) failures.push({ where, message: 'no floor pixel at y29' });
  const topRow = grid[TOP];
  if (![...topRow].some((cell) => cell !== '.')) {
    failures.push({ where, message: 'no pixel at true top y4' });
  }
  if (dir === 'front' || dir === 'rear') {
    // Two separate soles: the stance gap stays transparent through y29.
    if (grid[BOTTOM][15] !== '.' || grid[BOTTOM][16] !== '.') {
      failures.push({ where, message: 'soles not split at x15..16' });
    }
  }
}

// The shoe sole (sprite row y29) must land exactly on baselineY - 1 with
// the stand line directly below it: opaque sole, transparent stance gap,
// no 2px gap.
function checkStrip(
  layout: { width: number; baselineY: number; figureX: number },
  pixels: { width: number; data: Uint8ClampedArray },
  failures: Failure[],
): void {
  const at = (x: number, y: number): boolean => pixels.data[(y * pixels.width + x) * 4 + 3] !== 0;
  if (!at(layout.figureX + 12, layout.baselineY - 1)) {
    failures.push({ where: 'scale', message: 'left sole missing above stand line' });
  }
  if (at(layout.figureX + 15, layout.baselineY - 1)) {
    failures.push({ where: 'scale', message: 'stance gap not transparent above stand line' });
  }
}

function skinRowPng(): { width: number; height: number; data: Uint8ClampedArray } {
  const bar = 32;
  const gap = 8;
  const width = SKIN_TONES.length * bar * 3 + (SKIN_TONES.length - 1) * gap;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  SKIN_TONES.forEach((tone, t) => {
    tone.ramp.forEach((hex, b) => {
      const n = Number.parseInt(hex.replace('#', ''), 16);
      const ox = t * (bar * 3 + gap) + b * bar;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < bar; x++) {
          const idx = (y * width + ox + x) * 4;
          data[idx] = (n >> 16) & 255;
          data[idx + 1] = (n >> 8) & 255;
          data[idx + 2] = n & 255;
          data[idx + 3] = 255;
        }
      }
    });
  });
  return { width, height, data };
}

function usage(): string {
  return 'usage: generate.ts --preview-dir <dir>';
}

// The shared composer needs a TypeScript-aware loader (tsx), which plain
// node strip-types does not provide. The helper runs the unchanged
// composer via the existing tsx binary and reports frame extents as JSON.
function renderBefore(outDir: string, failures: Failure[]): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // No fixed personal paths: resolve the existing tsx next to this script
  // (documented node_modules symlink), then at the repository root, then
  // fall back to PATH. Nothing is installed.
  const hereTsx = join(here, 'node_modules', '.bin', 'tsx');
  const rootTsx = join(here, '..', '..', '..', 'node_modules', '.bin', 'tsx');
  const tsx = [hereTsx, rootTsx].find((path) => existsSync(path)) ?? 'tsx';
  if (tsx === 'tsx' && !process.env.PATH) {
    failures.push({ where: 'before', message: 'tsx binary not found in existing node_modules' });
    return;
  }
  const result = spawnSync(tsx, [join(here, 'before-render.ts'), '--out-dir', outDir], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ where: 'before', message: `before-render failed: ${(result.stderr || '').slice(0, 300)}` });
    return;
  }
  const lastLine = result.stdout.trim().split('\n').pop() ?? '';
  const report = JSON.parse(lastLine) as {
    frames: Array<{ name: string; minY: number; maxY: number; empty: boolean }>;
  };
  if (report.frames.length !== FIGURES.length * DIRECTIONS.length) {
    failures.push({ where: 'before', message: `expected 16 frames, got ${report.frames.length}` });
    return;
  }
  // Before extents are product reality and only reported: the strict
  // y4..y29 band applies to the new hand-set after-grids below.
  for (const frame of report.frames) {
    if (frame.empty) failures.push({ where: frame.name, message: 'before frame is empty' });
    console.log(`before ${frame.name}: y${frame.minY}..y${frame.maxY}`);
  }
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf('--preview-dir');
  const previewDir = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!previewDir || previewDir.startsWith('--')) {
    console.error(usage());
    process.exit(2);
  }
  const outDir = join(previewDir, 'out', 'style');
  await mkdir(outDir, { recursive: true });

  const failures: Failure[] = [];
  let written = 0;
  const writePng = async (name: string, width: number, height: number, data: Uint8ClampedArray): Promise<void> => {
    await writeFile(join(outDir, name), encodePng(width, height, data));
    written += 1;
  };

  renderBefore(outDir, failures);
  for (const figure of FIGURES) {
    const palette = figurePalette(figure.skin, figure.hairColor);
    for (const dir of DIRECTIONS) {
      const grid = composeAfter(figure, dir);
      checkGrid(figure.id, dir, grid, failures);
      await writePng(`${figure.id}_${dir}_after.png`, GRID, GRID, gridToRgba(grid, palette));
      if (!existsSync(join(outDir, `${figure.id}_${dir}_before.png`))) {
        failures.push({ where: `${figure.id}/${dir}/before`, message: 'before frame missing' });
      }
    }
  }

  const skin = skinRowPng();
  await writePng('skin_row.png', skin.width, skin.height, skin.data);

  const fig1 = FIGURES[0];
  const frontGrid = composeAfter(fig1, 'front');
  const { layout, pixels } = buildScaleStrip(gridToRgba(frontGrid, figurePalette(fig1.skin, fig1.hairColor)));
  checkStrip(layout, pixels, failures);
  await writePng('scale_strip.png', pixels.width, pixels.height, pixels.data);

  const html = buildHtml({
    figures: FIGURES,
    pngPath: (name) => `out/style/${name}`,
    generatedAt: new Date().toISOString(),
  });
  await writeFile(join(previewDir, 'style.html'), html);
  written += 1;

  const afterCount = FIGURES.length * DIRECTIONS.length;
  console.log(`figures: ${FIGURES.length}, views: ${DIRECTIONS.length}, before+after frames: ${afterCount * 2}`);
  console.log(`files written: ${written + afterCount} (style.html + out/style/*.png)`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure.where}: ${failure.message}`);
    process.exit(1);
  }
  console.log('acceptance: ok');
}

await main();
