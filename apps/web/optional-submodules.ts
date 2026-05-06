/**
 * Vite-Plugin: Optional private submodules als leeres Modul auflösen.
 * Verhindert Fehler wenn `@meetropolis/desktop`, `@meetropolis/enterprise-web`
 * oder `@meetropolis/brand-web` (privatie Submodules) nicht installiert sind.
 * Die jeweiligen *Loader.ts-Dateien fangen den fehlenden Export per try/catch
 * ab und liefern null zurück; OSS-Code rendert dann generische Fallbacks.
 *
 * Wenn das Submodule vorhanden ist (package.json existiert), wird der Import
 * normal aufgelöst — das Plugin greift dann NICHT ein. Als Fallback wird auch
 * ein node_modules-Symlink angelegt, falls npm ihn nicht automatisch erstellt
 * (bekanntes Problem mit Git Submodules + Workspaces).
 *
 * Dieses Plugin wird sowohl in vite.config.ts (build) als auch in
 * vitest.config.ts (tests) eingebunden, damit OSS-only Test-Runs ohne
 * Submodule grün durchlaufen.
 */
import type { Plugin } from 'vite';
import { resolve, dirname, join, relative } from 'path';
import { existsSync, mkdirSync, symlinkSync, readdirSync, lstatSync, readlinkSync, statSync, unlinkSync } from 'fs';

type OptionalSubmoduleSpec =
  | string
  | { id: string; path: string; publicDir?: string };

function defaultPathFor(id: string): string {
  const pkgName = id.replace(/^@meetropolis\//, '');
  return `packages/${pkgName}`;
}

function normalizeSpec(
  spec: OptionalSubmoduleSpec,
): { id: string; path: string; publicDir?: string } {
  return typeof spec === 'string' ? { id: spec, path: defaultPathFor(spec) } : spec;
}

/**
 * Symlinkt alle Files aus `submodulePublicDir` rekursiv nach `targetPublicDir`.
 * - Pro Datei (nicht pro Top-Level-Folder), damit OSS-Folder wie `images/`
 *   nicht durch einen einzelnen Submodule-Symlink überschrieben werden.
 * - Existierende Dateien in `targetPublicDir` werden NICHT überschrieben
 *   (OSS-eigene Assets gewinnen).
 * - Existierende Symlinks zum gleichen Ziel sind OK (idempotent).
 * - Fail silently bei Symlink-Fehlern.
 */
// existsSync folgt Symlinks → broken Symlink (z.B. absoluter Host-Pfad
// im Container) returnt false, obwohl der Link selbst da ist. Wir
// brauchen lstat, um broken Symlinks zu erkennen und ersetzen zu können.
function lstatSyncSafe(p: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(p); } catch { return null; }
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
      // Symlink-Ziel relativ zum Quelldateipfad — sonst zeigt der Link
      // auf den absoluten Host-Pfad und bricht im Docker-Container, wo
      // /Users/... nicht existiert.
      const relSrc = relative(dirname(dstPath), srcPath);
      if (existsSync(dstPath) || lstatSyncSafe(dstPath)) {
        try {
          const lst = lstatSync(dstPath);
          if (lst.isSymbolicLink()) {
            const current = readlinkSync(dstPath);
            // Bereits relativer Symlink zum richtigen Ziel? -> OK.
            if (current === relSrc) continue;
            // Alter absoluter Symlink — neu anlegen, damit er auch im
            // Container auflöst.
            unlinkSync(dstPath);
          } else {
            // Echte Datei (OSS-Asset gewinnt) — nicht überschreiben.
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

export function optionalSubmodules(specs: OptionalSubmoduleSpec[] = OPTIONAL_SUBMODULES, repoRoot = resolve(__dirname, '../..')): Plugin {
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

      // Public-Assets aus dem Submodule nach apps/web/public/ symlinken.
      // Default: <path>/public falls vorhanden, sonst expliziter publicDir.
      const submodulePublicDir = publicDir
        ? resolve(repoRoot, publicDir)
        : resolve(pkgDir, 'public');
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
