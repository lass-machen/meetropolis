import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const publicCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public.css'), 'utf8');

function pressStartFaces(): string[] {
  const faces: string[] = [];
  const re = /@font-face\s*\{[^}]*\}/g;
  for (const match of publicCss.matchAll(re)) {
    const block = match[0];
    if (/font-family\s*:\s*['"]Press Start 2P['"]/.test(block)) {
      faces.push(block);
    }
  }
  return faces;
}

describe('Press Start 2P unicode-range sources', () => {
  it('limits the woff2 face to basic Latin and serves umlauts from the full ttf', () => {
    const faces = pressStartFaces();
    const woff2 = faces.find((b) => /PressStart2P\.woff2/.test(b));
    const ttf = faces.find((b) => /PressStart2P-Regular\.ttf/.test(b));

    expect(woff2, 'expected a Press Start 2P @font-face for the woff2').toBeDefined();
    expect(ttf, 'expected a Press Start 2P @font-face for PressStart2P-Regular.ttf').toBeDefined();

    expect(woff2!).toMatch(/unicode-range\s*:\s*U\+0020-007E\s*;/);

    expect(ttf!).toMatch(/unicode-range\s*:/);
    expect(ttf!).toMatch(/U\+00E4/);
    expect(ttf!).toMatch(/U\+00DF/);
  });
});
