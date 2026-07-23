// Front-idle frame rendering for the editor's preview and option tiles. Both go
// through the SAME shared composer the server uses, so a tile shows exactly the
// sheet a click would store (no second renderer, no drift).
//
// composeSheet always builds the whole 128x256 sheet; the composer exposes no
// single-frame entry point and stays untouched here. Measured at ~0.4 ms per
// sheet, so a full tile grid costs ~10 ms — the memo below exists to keep
// repeated renders (re-renders, tab switches, revisits) free, not to rescue a
// slow path.

import {
  canonicalConfigString,
  composeSheet,
  validateConfig,
  type AvatarConfig,
  type RgbaImage,
  type SpriteCatalog,
} from '@meetropolis/shared';

// One frame is 32*32*4 = 4 KB, so the cap bounds the cache at ~1 MB.
const CACHE_LIMIT = 256;
const cache = new Map<string, Uint8ClampedArray>();

/** Copy the front-idle cell (sheet top-left) out of a composed sheet. */
export function frontIdleCell(sheet: RgbaImage, fw: number, fh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(fw * fh * 4);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const src = (y * sheet.width + x) * 4;
      const dst = (y * fw + x) * 4;
      out[dst] = sheet.data[src];
      out[dst + 1] = sheet.data[src + 1];
      out[dst + 2] = sheet.data[src + 2];
      out[dst + 3] = sheet.data[src + 3];
    }
  }
  return out;
}

/**
 * Render a config's front-idle frame, memoised on the config's canonical
 * identity: two configs that render identically share one cache entry, and
 * fields that do not affect the sheet (pants under a dress) never split it.
 * Returns null for an unrenderable config (e.g. the hood under the base
 * outfit) — the caller shows that option as disabled rather than crashing.
 */
export function frontIdleFrame(catalog: SpriteCatalog, config: AvatarConfig): Uint8ClampedArray | null {
  if (!validateConfig(catalog, config).ok) return null;
  const key = canonicalConfigString(catalog, config);

  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key); // re-insert: Map keeps insertion order, so this is the LRU touch
    cache.set(key, hit);
    return hit;
  }

  const { frame_w: fw, frame_h: fh } = catalog.format;
  const frame = frontIdleCell(composeSheet(catalog, config), fw, fh);
  cache.set(key, frame);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return frame;
}
