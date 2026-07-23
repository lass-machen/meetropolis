// Isomorphic sprite composer: turns an AvatarConfig + the v5 catalog into the
// spec 128x256 RGBA sheet. Shared verbatim by the web editor's live preview and
// the server's one-shot compositing, so preview == the stored sheet.
//
// The core is DOM- and Node-free: it never touches Canvas, fs or pngjs. The
// server pairs composeSheet with a pngjs encoder; the client pairs it with
// putImageData.

export * from './types.js';
export { buildPalette, configValue, hexToRgba } from './palette.js';
export { blitGrid, makeFrame, mirrorFrame } from './frame.js';
export { composeSheet, getGrid } from './sheet.js';
export { canonicalConfig, canonicalConfigString, validateConfig } from './configSchema.js';
export type { ValidationResult } from './configSchema.js';

import { CATALOG_SCHEMA_V5, type SpriteCatalog } from './types.js';

/**
 * Assert an untyped value is a v5 sprite catalog (schema + required blocks) and
 * narrow it. A schema mismatch or missing block fails loudly here rather than
 * drifting silently at render time. Both server and client call this on load.
 */
export function assertSpriteCatalog(value: unknown): SpriteCatalog {
  if (typeof value !== 'object' || value === null) throw new Error('sprite catalog: not an object');
  const record = value as Record<string, unknown>;
  if (record.schema !== CATALOG_SCHEMA_V5) {
    throw new Error(`sprite catalog: expected schema ${CATALOG_SCHEMA_V5}, got ${String(record.schema)}`);
  }
  for (const key of ['format', 'palettes', 'catalogs', 'compose'] as const) {
    if (typeof record[key] !== 'object' || record[key] === null) {
      throw new Error(`sprite catalog: missing '${key}' block`);
    }
  }
  return value as SpriteCatalog;
}
