#!/usr/bin/env node
/**
 * Post-build helper: copies the canonical sprite catalog
 * (`packages/shared/sprite/catalog.json`) into `dist/sprite-catalog.json`.
 *
 * Why: the character-editor compositing reads the v5 catalog at runtime. The
 * catalog is a committed data file, NOT TypeScript, so `tsc` never emits it.
 * Placing a copy right next to `dist/index.js` makes the runtime lookup
 * deploy-robust: the server resolves it relative to its own bundle instead of
 * depending on the surrounding monorepo layout being preserved in the image
 * (see spriteCatalog loader; SPRITE_CATALOG_PATH overrides both). Missing
 * source is non-fatal here — the loader falls back to the workspace path and
 * the feature is gated OFF by default anyway.
 *
 * Pure Node, no external deps. Works on macOS, Linux, and Docker.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const src = path.resolve(serverDir, '..', '..', 'packages', 'shared', 'sprite', 'catalog.json');
const dst = path.join(serverDir, 'dist', 'sprite-catalog.json');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(src))) {
    console.warn(`[copy-catalog] source not found, skipping: ${src}`);
    return;
  }
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  console.log(`[copy-catalog] copied ${path.relative(serverDir, src)} → ${path.relative(serverDir, dst)}`);
}

main().catch((err) => {
  console.error('[copy-catalog] failed:', err);
  process.exit(1);
});
