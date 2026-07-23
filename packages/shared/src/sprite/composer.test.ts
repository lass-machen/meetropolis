// Unit tests for the shared composer primitives. The end-to-end pixel parity is
// covered by composer.golden.test.ts; these pin the individual mechanics that
// must match engine.py (blit skip-transparent + clip, mirror, palette
// later-wins) and the data-driven validation rules.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blitGrid, makeFrame, mirrorFrame } from './frame.js';
import { buildPalette, hexToRgba } from './palette.js';
import { canonicalConfig, canonicalConfigString, validateConfig } from './configSchema.js';
import { composeSheet } from './sheet.js';
import { assertSpriteCatalog } from './index.js';
import type { AvatarConfig, Rgba } from './types.js';

const catalog = assertSpriteCatalog(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../sprite/catalog.json', import.meta.url)), 'utf8')),
);

const base: AvatarConfig = {
  skin: 'light',
  hair: 'messy',
  hair_color: 'braun',
  outfit: 'trousers',
  top: 'shirt_white',
  pants: 'dark',
  shoes: 'black',
};

function pixel(frame: Uint8ClampedArray, width: number, x: number, y: number): Rgba {
  const i = (y * width + x) * 4;
  return [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]];
}

/** Rendered sheet bytes — lets a test assert on what a config actually LOOKS like. */
function sheetBytes(config: AvatarConfig): Uint8ClampedArray {
  return composeSheet(catalog, config).data;
}

describe('hexToRgba', () => {
  it('parses with and without a leading #', () => {
    expect(hexToRgba('#2e222f')).toEqual([46, 34, 47, 255]);
    expect(hexToRgba('ffffff')).toEqual([255, 255, 255, 255]);
  });
  it('throws on malformed input', () => {
    expect(() => hexToRgba('#12')).toThrow();
    expect(() => hexToRgba('#gggggg')).toThrow();
  });
});

describe('blitGrid', () => {
  const palette = new Map<string, Rgba>([
    ['A', [10, 20, 30, 255]],
    ['B', [40, 50, 60, 255]],
  ]);

  it('hard-replaces and skips transparent source pixels', () => {
    const frame = makeFrame(4, 4);
    blitGrid(frame, 4, 4, ['AA..', '....', '....', '....'], 0, 0, palette);
    // A later grid with '.' over (0,0) must NOT clear it; 'B' at (1,0) replaces A.
    blitGrid(frame, 4, 4, ['.B..', '....', '....', '....'], 0, 0, palette);
    expect(pixel(frame, 4, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(frame, 4, 1, 0)).toEqual([40, 50, 60, 255]);
  });

  it('clips pixels shifted out of the frame', () => {
    const frame = makeFrame(4, 4);
    // dx/dy push the single 'A' to (5,5) -> clipped, nothing drawn.
    blitGrid(frame, 4, 4, ['A'], 5, 5, palette);
    expect(Array.from(frame).every((byte) => byte === 0)).toBe(true);
  });

  it('throws on an unknown slot char', () => {
    const frame = makeFrame(4, 4);
    expect(() => blitGrid(frame, 4, 4, ['Z'], 0, 0, palette)).toThrow(/no palette colour/);
  });
});

describe('mirrorFrame', () => {
  it('reverses columns (x -> width-1-x)', () => {
    const frame = makeFrame(4, 1);
    blitGrid(frame, 4, 1, ['A...'], 0, 0, new Map<string, Rgba>([['A', [1, 2, 3, 255]]]));
    const mirrored = mirrorFrame(frame, 4, 1);
    expect(pixel(mirrored, 4, 3, 0)).toEqual([1, 2, 3, 255]);
    expect(pixel(mirrored, 4, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('buildPalette', () => {
  it('derives brow slot R from the hair shadow slot j (later-wins)', () => {
    const palette = buildPalette(catalog, base);
    expect(palette.get('R')).toEqual(palette.get('j'));
    expect(palette.get('O')).toEqual([46, 34, 47, 255]); // outline
  });
  it('includes accessory palettes only when the accessory is worn', () => {
    expect(buildPalette(catalog, base).has('G')).toBe(false); // no glasses
    expect(buildPalette(catalog, { ...base, glasses: 'rect' }).has('G')).toBe(true);
  });
});

describe('validateConfig', () => {
  it('accepts a complete trousers config', () => {
    expect(validateConfig(catalog, base)).toEqual({ ok: true, errors: [] });
  });
  it('accepts a dress config without pants', () => {
    const dress: AvatarConfig = {
      skin: 'light',
      hair: 'long',
      hair_color: 'rot',
      outfit: 'dress',
      top: 'dress_red',
      shoes: 'brown',
    };
    expect(validateConfig(catalog, dress).ok).toBe(true);
  });
  it('rejects a trousers config missing a required field', () => {
    const { top: _omitted, ...noTop } = base;
    const result = validateConfig(catalog, noTop);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("outfit 'trousers' requires top");
  });
  it('rejects an unknown catalog value', () => {
    const result = validateConfig(catalog, { ...base, hair: 'mohawk' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('invalid hair: mohawk');
  });
  it('rejects hood with the base outfit', () => {
    const result = validateConfig(catalog, {
      skin: 'light',
      hair: 'bald',
      hair_color: 'braun',
      outfit: 'base',
      hat: 'hood',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("hood is not valid with outfit 'base'");
  });
});

describe('canonicalConfig', () => {
  it('drops fields that do not affect the rendered sheet', () => {
    const dress: AvatarConfig = { ...base, outfit: 'dress', top: 'dress_red', shoes: 'brown' };
    const canonical = canonicalConfig(catalog, dress);
    expect(canonical.pants).toBeUndefined(); // pants are ignored under a dress
    expect(canonical.top).toBe('dress_red');
  });
  it('normalizes the hair style under a hood, which hides it', () => {
    const bob = canonicalConfigString(catalog, { ...base, hat: 'hood', hair: 'bob' });
    const curly = canonicalConfigString(catalog, { ...base, hat: 'hood', hair: 'curly' });
    expect(bob).toBe(curly); // same sheet -> same identity anchor
    // Without the hood the style is visible, so it must stay part of the identity.
    expect(canonicalConfigString(catalog, { ...base, hair: 'bob' })).not.toBe(
      canonicalConfigString(catalog, { ...base, hair: 'curly' }),
    );
  });
  it('keeps the hood-normalized hair a catalog-valid, renderable value', () => {
    // `hair` is required and its slots always resolve: a dropped or synthetic
    // value would make the canonical config unrenderable (500 on compose).
    const canonical = canonicalConfig(catalog, { ...base, hat: 'hood', hair: 'bob' });
    expect(catalog.compose.config_fields.hair.values).toContain(canonical.hair);
    expect(validateConfig(catalog, canonical).ok).toBe(true);
    expect(() => composeSheet(catalog, canonical)).not.toThrow();
    // The stand-in renders exactly like the style it replaced.
    expect(sheetBytes({ ...base, hat: 'hood', hair: 'bob' })).toEqual(sheetBytes(canonical));
  });
  it('keeps hair_color significant under a hood (it drives the derived brow slot)', () => {
    const braun: AvatarConfig = { ...base, hat: 'hood', hair: 'bob', hair_color: 'braun' };
    const rot: AvatarConfig = { ...base, hat: 'hood', hair: 'bob', hair_color: 'rot' };
    // The sheets genuinely differ, so the anchor MUST differ too — dropping
    // hair_color here would dedup two different-looking avatars onto one sheet.
    expect(sheetBytes(braun)).not.toEqual(sheetBytes(rot));
    expect(canonicalConfigString(catalog, braun)).not.toBe(canonicalConfigString(catalog, rot));
  });
  it('keeps beard_color only when a beard is worn and defaults it', () => {
    const withBeard = canonicalConfig(catalog, { ...base, beard: 'vollbart' });
    expect(withBeard.beard_color).toBe('braun');
    const noBeard = canonicalConfig(catalog, base);
    expect(noBeard.beard_color).toBeUndefined();
  });
  it('produces a stable, sorted-key string equal for equivalent configs', () => {
    const a = canonicalConfigString(catalog, { ...base, misc: 'kette' });
    const b = canonicalConfigString(catalog, {
      misc: 'kette',
      shoes: 'black',
      pants: 'dark',
      top: 'shirt_white',
      outfit: 'trousers',
      hair_color: 'braun',
      hair: 'messy',
      skin: 'light',
    });
    expect(a).toBe(b);
    expect(a.startsWith('{"hair"')).toBe(true); // keys sorted
  });
});
