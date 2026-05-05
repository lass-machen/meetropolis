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
import { resolve } from 'path';
import { existsSync, mkdirSync, symlinkSync } from 'fs';

type OptionalSubmoduleSpec = string | { id: string; path: string };

function defaultPathFor(id: string): string {
  const pkgName = id.replace(/^@meetropolis\//, '');
  return `packages/${pkgName}`;
}

function normalizeSpec(spec: OptionalSubmoduleSpec): { id: string; path: string } {
  return typeof spec === 'string' ? { id: spec, path: defaultPathFor(spec) } : spec;
}

export const OPTIONAL_SUBMODULES: OptionalSubmoduleSpec[] = [
  '@meetropolis/desktop',
  { id: '@meetropolis/enterprise-web', path: 'packages/tenancy-enterprise/packages/enterprise-web' },
  { id: '@meetropolis/brand-web', path: 'packages/brand/packages/web' },
];

export function optionalSubmodules(specs: OptionalSubmoduleSpec[] = OPTIONAL_SUBMODULES, repoRoot = resolve(__dirname, '../..')): Plugin {
  const normalized = specs.map(normalizeSpec);
  const set = new Set(normalized.map((s) => s.id));

  const present = new Set<string>();
  for (const { id, path: relPath } of normalized) {
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
