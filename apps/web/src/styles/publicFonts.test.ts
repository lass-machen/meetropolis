import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const publicCss = readFileSync(join(here, 'public.css'), 'utf8');
const fontsDir = join(here, '..', '..', 'public', 'fonts');

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

describe('Press Start 2P source', () => {
  it('serves the wordmark only from the unmodified full ttf', () => {
    const faces = pressStartFaces();

    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatch(/src\s*:\s*url\('\/fonts\/PressStart2P-Regular\.ttf'\)\s*format\('truetype'\)\s*;/);
    // The full font covers umlauts and eszett itself, so no range split.
    expect(faces[0]).not.toMatch(/unicode-range/);
  });

  it('ships no subset copy of the font', () => {
    expect(publicCss).not.toMatch(/PressStart2P\.woff2/);
    expect(existsSync(join(fontsDir, 'PressStart2P.woff2'))).toBe(false);
    expect(existsSync(join(fontsDir, 'PressStart2P-Regular.ttf'))).toBe(true);
  });
});
