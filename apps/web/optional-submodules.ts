/**
 * Vite plugin: resolve optional closed-source sibling repos as a graceful
 * null module when they are not present.
 *
 * Three sibling repos can extend this OSS build at compile time:
 *   - @meetropolis/brand-web    — marketing landing, logo assets, pixel tracking
 *   - @meetropolis/desktop      — Tauri desktop wrapper
 *   - @meetropolis/enterprise-web — multi-tenancy / billing admin UI
 *
 * They are NOT submodules. The OSS repo does not reference them in any
 * tracked file. Tiamat maintainers clone them parallel to the OSS repo
 * (`../meetropolis-{brand,desktop,enterprise}`). CI / Docker / non-standard
 * layouts can override each path explicitly via env var:
 *   - MEETROPOLIS_BRAND_PATH
 *   - MEETROPOLIS_DESKTOP_PATH
 *   - MEETROPOLIS_ENTERPRISE_PATH
 *
 * Resolution order per spec (first match wins):
 *   1. If env var is set and the path contains a package.json → use it.
 *   2. If the sibling-clone default path contains a package.json → use it.
 *   3. If the in-tree fallback (used by the Docker build context, where
 *      prepare-build.sh rsyncs sibling sources into packages/) contains a
 *      package.json → use it.
 *   4. Otherwise → return null, the corresponding loader (brandLoader.ts /
 *      desktopLoader.ts / enterpriseWebLoader.ts) catches the null and
 *      renders the OSS-only fallback.
 *
 * When resolved, the plugin
 *   - creates `node_modules/@meetropolis/<name>` as a symlink to the resolved
 *     directory (workspace-style), and
 *   - mirrors the package's `public/` (or explicit publicDir) into
 *     `apps/web/public/` file-by-file (OSS files always win on conflict).
 *
 * Wired into both vite.config.ts (build) and vitest.config.ts (tests).
 */
import type { Plugin } from 'vite';
import { resolve, dirname, isAbsolute, join, relative } from 'path';
import { existsSync, mkdirSync, symlinkSync, readdirSync, lstatSync, readlinkSync, statSync, unlinkSync } from 'fs';

export type OptionalSubmoduleSpec = {
  /** npm package id, e.g. `@meetropolis/brand-web`. */
  id: string;
  /** Env var that overrides the sibling-clone default (e.g. `MEETROPOLIS_BRAND_PATH`). */
  envVar: string;
  /** Default path relative to the OSS repo root (e.g. `../meetropolis-brand/packages/web`). */
  siblingPath: string;
  /**
   * In-tree fallback path relative to the OSS repo root, used when the
   * sibling-clone default is not present — the Docker build context only
   * sees the OSS tree, and prepare-build.sh rsyncs sibling sources into
   * packages/{brand,tenancy-enterprise,desktop}/ before building.
   */
  inTreePath: string;
  /**
   * Optional explicit public-assets directory, relative to the resolved
   * package directory. Defaults to `<resolved>/public`.
   */
  publicDir?: string;
};

/**
 * Recursively symlink files from `submodulePublicDir` into `targetPublicDir`.
 * - One symlink per file (not per folder) so OSS folders like `images/` are
 *   not shadowed by a single submodule-level symlink.
 * - Existing real files in `targetPublicDir` are never overwritten (OSS wins).
 * - Existing relative symlinks pointing at the same target are kept (idempotent).
 * - Stale absolute symlinks (typical when a Docker container inherits links
 *   pointing at host paths) are replaced with relative ones.
 * - Errors are swallowed silently — broken symlinks must never break the build.
 */
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
      // Symlink target is relative to the destination so the link resolves
      // correctly both on the host and inside the Docker container.
      const relSrc = relative(dirname(dstPath), srcPath);
      if (existsSync(dstPath) || lstatSyncSafe(dstPath)) {
        try {
          const lst = lstatSync(dstPath);
          if (lst.isSymbolicLink()) {
            const current = readlinkSync(dstPath);
            if (current === relSrc) continue; // already correct
            unlinkSync(dstPath); // stale absolute symlink → replace
          } else {
            continue; // real OSS file — never overwrite
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

/**
 * Resolve the directory for one spec.
 * The env var is an explicit override: if set, it wins regardless of what
 * the sibling-clone default would find. If neither resolves to a directory
 * with a `package.json`, returns null (loader falls back to OSS-only mode).
 */
function resolveSpecDir(spec: OptionalSubmoduleSpec, repoRoot: string): string | null {
  const envValue = process.env[spec.envVar];
  const candidates: string[] = [];
  if (envValue && envValue.trim().length > 0) {
    candidates.push(isAbsolute(envValue) ? envValue : resolve(repoRoot, envValue));
  }
  candidates.push(resolve(repoRoot, spec.siblingPath));
  candidates.push(resolve(repoRoot, spec.inTreePath));
  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
  }
  return null;
}

export const OPTIONAL_SUBMODULES: OptionalSubmoduleSpec[] = [
  {
    id: '@meetropolis/desktop',
    envVar: 'MEETROPOLIS_DESKTOP_PATH',
    siblingPath: '../meetropolis-desktop',
    inTreePath: 'packages/desktop',
  },
  {
    id: '@meetropolis/enterprise-web',
    envVar: 'MEETROPOLIS_ENTERPRISE_PATH',
    siblingPath: '../meetropolis-enterprise/packages/enterprise-web',
    inTreePath: 'packages/tenancy-enterprise/packages/enterprise-web',
  },
  {
    id: '@meetropolis/brand-web',
    envVar: 'MEETROPOLIS_BRAND_PATH',
    siblingPath: '../meetropolis-brand/packages/web',
    inTreePath: 'packages/brand/packages/web',
    publicDir: 'public',
  },
];

export function optionalSubmodules(
  specs: OptionalSubmoduleSpec[] = OPTIONAL_SUBMODULES,
  repoRoot = resolve(__dirname, '../..'),
): Plugin {
  const allIds = new Set(specs.map((s) => s.id));
  const presentIds = new Set<string>();
  const targetPublicDir = resolve(repoRoot, 'apps/web/public');

  for (const spec of specs) {
    const resolvedDir = resolveSpecDir(spec, repoRoot);
    if (!resolvedDir) continue;

    presentIds.add(spec.id);

    // Create node_modules/@meetropolis/<name> symlink (workspace-style),
    // so `import '@meetropolis/<name>'` resolves to the sibling clone.
    const pkgName = spec.id.replace(/^@meetropolis\//, '');
    const linkDir = resolve(repoRoot, 'node_modules', '@meetropolis');
    const linkPath = resolve(linkDir, pkgName);
    if (!existsSync(linkPath)) {
      try {
        mkdirSync(linkDir, { recursive: true });
        symlinkSync(resolvedDir, linkPath, 'dir');
      } catch {}
    }

    // Mirror public assets if the sibling has any.
    const publicSrc = spec.publicDir ? resolve(resolvedDir, spec.publicDir) : resolve(resolvedDir, 'public');
    if (existsSync(publicSrc)) {
      linkPublicAssets(publicSrc, targetPublicDir);
    }
  }

  return {
    name: 'optional-submodules',
    enforce: 'pre',
    resolveId(source) {
      if (allIds.has(source) && !presentIds.has(source)) {
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
