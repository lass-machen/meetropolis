import fs from 'fs';
import path from 'path';
import type { Prisma } from '../src/generated/prisma/index.js';

export const ATELIER_PACK_UUID = '4664b745-6bad-4d86-ae8f-591c57567692';

export interface AtelierCatalog {
  generation: string;
  manifest: string;
  palette: {
    name: string;
    packUuid: string;
    packVersion: string;
  };
  avatars: Array<{
    key: string;
    url: string;
  }>;
}

interface AtelierPackManifest {
  author: string;
  terrain: Prisma.InputJsonArray;
  structures: Prisma.InputJsonArray;
  objects: Prisma.InputJsonArray;
  autotiles: Prisma.InputJsonArray;
}

export interface AtelierProductData {
  catalog: AtelierCatalog;
  pack: AtelierPackManifest;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function loadAtelierProductData(repoRoot: string): AtelierProductData {
  const catalogPath = path.join(repoRoot, 'apps', 'web', 'public', 'assets', 'atelier', 'v1', 'catalog.json');
  const catalog = readJson<AtelierCatalog>(catalogPath);
  if (catalog.generation !== 'atelier-v1' || catalog.palette.packUuid !== ATELIER_PACK_UUID) {
    throw new Error('The atelier-v1 catalog identity does not match the shipped global pack.');
  }

  const manifestPath = path.resolve(repoRoot, catalog.manifest);
  if (path.relative(repoRoot, manifestPath).startsWith('..')) {
    throw new Error('The atelier-v1 manifest path escapes the repository root.');
  }
  return { catalog, pack: readJson<AtelierPackManifest>(manifestPath) };
}
