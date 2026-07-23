// Pixel-golden test: the shared TypeScript composer must reproduce the Python
// generator's reference sheets EXACTLY, across a fixture corpus that exercises
// every outfit mode, every accessory slot, hood and bald (the six shipped
// defaults only cover trousers/dress, which would leave those paths unproven).
//
// Comparison is pixel-exact, not byte-exact: PNG deflate encoding is not part
// of the contract, so we decode the reference PNGs to RGBA and compare buffers.
// Regenerate fixtures with: python3 tools/sprite-generator/generate.py \
//   --fixtures packages/shared/src/sprite/__fixtures__

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { assertSpriteCatalog } from './index.js';
import { composeSheet } from './sheet.js';
import type { AvatarConfig } from './types.js';

const catalogUrl = new URL('../../sprite/catalog.json', import.meta.url);
const catalog = assertSpriteCatalog(JSON.parse(readFileSync(fileURLToPath(catalogUrl), 'utf8')));

interface Fixture {
  name: string;
  config: AvatarConfig;
}
const fixturesDir = new URL('./__fixtures__/', import.meta.url);
const fixtures: Fixture[] = JSON.parse(readFileSync(fileURLToPath(new URL('fixtures.json', fixturesDir)), 'utf8'));

function firstPixelDiff(a: Uint8ClampedArray, b: Uint8Array, width: number): string | null {
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
    const px = i / 4;
    const x = px % width;
    const y = Math.floor(px / width);
    const got = `${a[i]},${a[i + 1]},${a[i + 2]},${a[i + 3]}`;
    const want = `${b[i]},${b[i + 1]},${b[i + 2]},${b[i + 3]}`;
    return `first diff at (${x},${y}): got [${got}] want [${want}]`;
  }
  return null;
}

describe('shared sprite composer (pixel-golden vs Python reference)', () => {
  it('has a non-trivial fixture corpus covering all slot paths', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
  });

  it.each(fixtures)('reproduces $name pixel-for-pixel', ({ name, config }) => {
    const reference = PNG.sync.read(readFileSync(fileURLToPath(new URL(`${name}.png`, fixturesDir))));
    const composed = composeSheet(catalog, config);

    expect(reference.width).toBe(composed.width);
    expect(reference.height).toBe(composed.height);
    expect(composed.data.length).toBe(reference.data.length);

    const diff = firstPixelDiff(composed.data, reference.data, composed.width);
    expect(diff, `${name}: ${diff}`).toBeNull();
  });
});
