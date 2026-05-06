#!/usr/bin/env node
/**
 * Post-build helper: copies the generated Prisma client runtime files
 * (`src/generated/prisma/*`) into `dist/generated/prisma/`.
 *
 * Why: TypeScript's `tsc` only emits `.ts` → `.js`. The Prisma generator
 * output mixes `.js`, `.d.ts`, native `.node` query-engine binaries, and
 * `.wasm` runtimes — none of which `tsc` knows about. Without this step
 * the production server (`node dist/index.js`) would fail to resolve
 * `./generated/prisma/index.js` at runtime.
 *
 * Pure Node, no external deps. Works on macOS, Linux, and Docker.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const src = path.join(serverDir, 'src', 'generated');
const dst = path.join(serverDir, 'dist', 'generated');

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
    console.error(`[copy-generated] missing source: ${src}`);
    console.error('[copy-generated] run `npm run prisma:generate` first');
    process.exit(1);
  }
  await mkdir(path.dirname(dst), { recursive: true });
  if (await exists(dst)) await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
  console.log(`[copy-generated] copied ${path.relative(serverDir, src)} → ${path.relative(serverDir, dst)}`);
}

main().catch((err) => {
  console.error('[copy-generated] failed:', err);
  process.exit(1);
});
