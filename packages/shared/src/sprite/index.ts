// Isomorphic sprite composer: turns an AvatarConfig + the v6 catalog into the
// spec 128x256 RGBA sheet. Shared verbatim by the web editor's live preview and
// the server's one-shot compositing, so preview == the stored sheet.
//
// The core is DOM- and Node-free: it never touches Canvas, fs or pngjs. The
// server pairs composeSheet with a pngjs encoder; the client pairs it with
// putImageData.

export * from './types.js';
export { buildPalette, configValue, hexToRgba } from './palette.js';
export { blitGrid, makeFrame, mirrorFrame } from './frame.js';
export { composeSheet, getGrid, resolveSpriteCatalog } from './sheet.js';
export { canonicalConfig, canonicalConfigString, validateConfig } from './configSchema.js';
export type { ValidationResult } from './configSchema.js';

import { CATALOG_SCHEMA_V6, type SpriteCatalog } from './types.js';

/**
 * Assert an untyped value is a v6 sprite catalog (schema + required blocks) and
 * narrow it. A schema mismatch or missing block fails loudly here rather than
 * drifting silently at render time. Both server and client call this on load.
 */
export function assertSpriteCatalog(value: unknown): SpriteCatalog {
  if (typeof value !== 'object' || value === null) throw new Error('sprite catalog: not an object');
  const record = value as Record<string, unknown>;
  if (record.schema !== CATALOG_SCHEMA_V6) {
    throw new Error(`sprite catalog: expected schema ${CATALOG_SCHEMA_V6}, got ${String(record.schema)}`);
  }
  for (const key of ['format', 'palettes', 'catalogs', 'compose', 'variants'] as const) {
    if (typeof record[key] !== 'object' || record[key] === null) {
      throw new Error(`sprite catalog: missing '${key}' block`);
    }
  }
  const variants = record.variants as Record<string, unknown>;
  if (typeof variants.proportion !== 'object' || variants.proportion === null) {
    throw new Error("sprite catalog: missing 'variants.proportion' block");
  }
  const proportion = variants.proportion as Record<string, unknown>;
  if (typeof proportion.default !== 'string' || !Array.isArray(proportion.values)) {
    throw new Error('sprite catalog: invalid proportion variant contract');
  }
  return value as SpriteCatalog;
}
