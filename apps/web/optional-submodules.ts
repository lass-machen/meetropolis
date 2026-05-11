/**
 * Vite plugin: resolve optional private submodules as an empty module.
 * Prevents errors when `@meetropolis/desktop`, `@meetropolis/enterprise-web`
 * or `@meetropolis/brand-web` (private submodules) are not installed.
 * The corresponding *Loader.ts files catch the missing export via try/catch
 * and return null; OSS code then renders generic fallbacks.
 *
 * When the submodule is present (package.json exists), the import resolves
 * normally and the plugin does NOT intervene. As a fallback, a node_modules
 * symlink is also created when npm does not generate one automatically
 * (a known issue with git submodules + workspaces).
 *
 * This plugin is wired into both vite.config.ts (build) and vitest.config.ts
 * (tests) so that OSS-only test runs without the submodules stay green.
 */
import type { Plugin } from 'vite';
import { resolve, dirname, join, relative } from 'path';
import { existsSync, mkdirSync, symlinkSync, readdirSync, lstatSync, readlinkSync, statSync, unlinkSync } from 'fs';

type OptionalSubmoduleSpec = string | { id: string; path: string; publicDir?: string };

function defaultPathFor(id: string): string {
  const pkgName = id.replace(/^@meetropolis\//, '');
  return `packages/${pkgName}`;
}

function normalizeSpec(spec: OptionalSubmoduleSpec): { id: string; path: string; publicDir?: string } {
  return typeof spec === 'string' ? { id: spec, path: defaultPathFor(spec) } : spec;
}

/**
 * Recursively symlink all files from `submodulePublicDir` into
 * `targetPublicDir`.
 * - One symlink per file (not per top-level folder), so OSS folders such as
 *   `images/` are not shadowed by a single submodule-level symlink.
 * - Existing files in `targetPublicDir` are NOT overwritten (OSS-owned
 *   assets win).
 * - Existing symlinks pointing to the same target are OK (idempotent).
 * - Fail silently on symlink errors.
 */
// existsSync follows symlinks; a broken symlink (e.g. an absolute host path
// inside the container) returns false even though the link itself exists.
// We need lstat to detect and replace broken symlinks.
function lstatSyncSafe(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function linkPublicAssets(submodulePublicDir: string, targetPublicDir: string): void {
  if (!existsSync(submodulePublicDir)) return;

  const walk = (srcDir: string, dstDir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(srcDir);
    } catch {
      return;
    }
    for (const name of entries) {
      const srcPath = join(srcDir, name);
      const dstPath = join(dstDir, name);
      let srcStat;
      try {
        srcStat = statSync(srcPath);
      } catch {
        continue;
      }
      if (srcStat.isDirectory()) {
        try {
          mkdirSync(dstDir, { recursive: true });
        } catch {}
        walk(srcPath, dstPath);
        continue;
      }
      // Symlink target is relative to the source file path; otherwise the
      // link points to the absolute host path and breaks inside the Docker
      // container where /Users/... does not exist.
      const relSrc = relative(dirname(dstPath), srcPath);
      if (existsSync(dstPath) || lstatSyncSafe(dstPath)) {
        try {
          const lst = lstatSync(dstPath);
          if (lst.isSymbolicLink()) {
            const current = readlinkSync(dstPath);
            // Already a relative symlink pointing at the right target? OK.
            if (current === relSrc) continue;
            // Stale absolute symlink: recreate so it resolves inside the
            // container as well.
            unlinkSync(dstPath);
          } else {
            // Real file (OSS asset wins): do not overwrite.
            continue;
          }
        } catch {}
      }
      try {
        mkdirSync(dirname(dstPath), { recursive: true });
        symlinkSync(relSrc, dstPath, 'file');
      } catch {}
    }
  };

  walk(submodulePublicDir, targetPublicDir);
}

export const OPTIONAL_SUBMODULES: OptionalSubmoduleSpec[] = [
  '@meetropolis/desktop',
  { id: '@meetropolis/enterprise-web', path: 'packages/tenancy-enterprise/packages/enterprise-web' },
  {
    id: '@meetropolis/brand-web',
    path: 'packages/brand/packages/web',
    publicDir: 'packages/brand/packages/web/public',
  },
];

export function optionalSubmodules(
  specs: OptionalSubmoduleSpec[] = OPTIONAL_SUBMODULES,
  repoRoot = resolve(__dirname, '../..'),
): Plugin {
  const normalized = specs.map(normalizeSpec);
  const set = new Set(normalized.map((s) => s.id));

  const present = new Set<string>();
  const targetPublicDir = resolve(repoRoot, 'apps/web/public');
  for (const spec of normalized) {
    const { id, path: relPath, publicDir } = spec;
    const pkgName = id.replace(/^@meetropolis\//, '');
    const pkgDir = resolve(repoRoot, relPath);
    const pkgJson = resolve(pkgDir, 'package.json');
    if (existsSync(pkgJson)) {
      present.add(id);
      const scope = id.split('/')[0]; // @meetropolis
      const linkDir = resolve(repoRoot, 'node_modules', scope);
      const linkPath = resolve(linkDir, pkgName);
      if (!existsSync(linkPath)) {
        try {
          mkdirSync(linkDir, { recursive: true });
          symlinkSync(pkgDir, linkPath, 'dir');
        } catch {}
      }

      // Symlink public assets from the submodule into apps/web/public/.
      // Default: <path>/public when present, otherwise the explicit publicDir.
      const submodulePublicDir = publicDir ? resolve(repoRoot, publicDir) : resolve(pkgDir, 'public');
      if (existsSync(submodulePublicDir)) {
        linkPublicAssets(submodulePublicDir, targetPublicDir);
      }
    }
  }

  return {
    name: 'optional-submodules',
    enforce: 'pre',
    resolveId(source) {
      if (set.has(source) && !present.has(source)) {
        return { id: `\0optional:${source}`, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0optional:')) {
        return 'export default null;';
      }
      return null;
    },
  };
}
