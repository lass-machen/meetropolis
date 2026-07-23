/**
 * Vite plugin: open-core boundary for optional closed-source sibling repos.
 *
 * In a pure OSS clone of this repository, every code path in this file is
 * effectively dead: none of the three sibling packages below ship with the
 * OSS tree, so step 4 of the resolution order always fires and the loaders
 * fall back to the OSS-only UI. The file is committed for two reasons:
 * (1) it lets the same `vite.config.ts` work in both the OSS and the Tiamat
 * build contexts without conditional imports, and (2) it documents the
 * open-core seam so contributors can see exactly where the boundary is.
 *
 * Four sibling packages can extend this OSS build at compile time:
 *   - @meetropolis/brand-web    — marketing landing, logo assets
 *   - @meetropolis/desktop      — Tauri desktop wrapper
 *   - @meetropolis/enterprise-web — multi-tenancy / billing admin UI
 *   - @meetropolis/telemetry-web — enterprise browser telemetry (error/analytics)
 *
 * They are NOT submodules. The OSS repo does not reference them in any
 * tracked file other than this plugin and the corresponding loader files.
 * Tiamat maintainers clone them parallel to the OSS repo
 * (`../meetropolis-{brand,desktop,enterprise}`; the enterprise clone carries
 * both the enterprise-web and the telemetry-web package). CI / Docker /
 * non-standard layouts can override each path explicitly via env var:
 *   - MEETROPOLIS_BRAND_PATH
 *   - MEETROPOLIS_DESKTOP_PATH
 *   - MEETROPOLIS_ENTERPRISE_PATH
 *   - MEETROPOLIS_TELEMETRY_PATH
 *
 * Resolution order per spec (first match wins):
 *   1. If env var is set and the path contains a package.json → use it.
 *   2. If the sibling-clone default path contains a package.json → use it.
 *   3. If the in-tree fallback path contains a package.json → use it.
 *      (This branch only fires in build contexts that pre-stage sibling
 *      sources inside the OSS tree — typical for Docker builds where the
 *      build context cannot reach sibling directories outside it.)
 *   4. Otherwise → return null, the corresponding loader (brandLoader.ts /
 *      desktopLoader.ts / enterpriseWebLoader.ts / telemetryLoader.ts) catches the null and
 *      renders the OSS-only fallback. **This is the path that fires in
 *      every pure OSS clone.**
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
import { OSS_META, readBrandMeta, injectSocialMeta, type SiteMetaProfile } from './socialMeta';
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'fs';

export type OptionalSubmoduleSpec = {
  /** npm package id, e.g. `@meetropolis/brand-web`. */
  id: string;
  /** Env var that overrides the sibling-clone default (e.g. `MEETROPOLIS_BRAND_PATH`). */
  envVar: string;
  /** Default path relative to the OSS repo root (e.g. `../meetropolis-brand/packages/web`). */
  siblingPath: string;
  /**
   * In-tree fallback path relative to the OSS repo root, used when the
   * sibling-clone default is not present. Build contexts that cannot
   * reach sibling directories (e.g. Docker builds with a restricted
   * context) can stage the sources here before invoking the build.
   * The OSS tree never ships these directories; they are an opt-in
   * mechanism for downstream packagers, not part of the upstream repo.
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
  // Force a pure-OSS resolution even on a machine that has the sibling repos
  // checked out next to this one. Lets a maintainer reproduce the exact build
  // the CI "OSS-only smoke" job runs (and that every public OSS clone gets)
  // without moving the siblings aside. Every slot falls through to the null
  // fallback below, so the loaders render their OSS-only UI.
  if (process.env.MEETROPOLIS_OSS_ONLY === '1') return null;
  const envValue = process.env[spec.envVar];
  const candidates: string[] = [];
  if (envValue && envValue.trim().length > 0) {
    candidates.push(isAbsolute(envValue) ? envValue : resolve(repoRoot, envValue));
  }
  candidates.push(resolve(repoRoot, spec.siblingPath));
  candidates.push(resolve(repoRoot, spec.inTreePath));
  for (const dir of candidates) {
    const pkgPath = resolve(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    // A package.json alone is not proof: in GitHub Actions the workspace
    // directory is named after the repository (e.g. .../meetropolis-desktop/
    // meetropolis-desktop), so the sibling candidate `../meetropolis-desktop`
    // can resolve to the checkout root itself. Accept a candidate only when
    // its package name matches the slot id, otherwise the symlink points at
    // the wrong tree and the dynamic import fails silently at runtime.
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown };
      if (pkg.name === spec.id) return dir;
    } catch {}
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
  {
    id: '@meetropolis/telemetry-web',
    envVar: 'MEETROPOLIS_TELEMETRY_PATH',
    siblingPath: '../meetropolis-enterprise/packages/telemetry-web',
    inTreePath: 'packages/tenancy-enterprise/packages/telemetry-web',
  },
];

export function optionalSubmodules(
  specs: OptionalSubmoduleSpec[] = OPTIONAL_SUBMODULES,
  repoRoot = resolve(__dirname, '../..'),
): Plugin {
  const allIds = new Set(specs.map((s) => s.id));
  const presentIds = new Set<string>();
  const targetPublicDir = resolve(repoRoot, 'apps/web/public');
  // Directory of the resolved brand package, captured to read its build-time
  // social meta (brand-meta.json) after the loop.
  let brandDir: string | null = null;

  for (const spec of specs) {
    const resolvedDir = resolveSpecDir(spec, repoRoot);
    if (!resolvedDir) continue;

    presentIds.add(spec.id);
    if (spec.id === '@meetropolis/brand-web') brandDir = resolvedDir;

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

  // Social/SEO meta baked into the static index.html: brand profile when the
  // brand submodule is present (its brand-meta.json), else the OSS default.
  // Built once here so crawlers (which never run the SPA) get the right title,
  // description and og:image without a runtime step.
  const siteMeta: SiteMetaProfile = (brandDir && readBrandMeta(brandDir)) || OSS_META;

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
    transformIndexHtml: {
      order: 'pre',
      handler: (html: string) => injectSocialMeta(html, siteMeta),
    },
  };
}
