import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { buildAtelierCatalog } from '../src/avatar-catalog.ts';

const catalogPath = fileURLToPath(new URL('../../../packages/shared/sprite/catalog.json', import.meta.url));

export async function generatedSpriteCatalog(): Promise<string> {
  const source = JSON.parse(await readFile(catalogPath, 'utf8')) as unknown;
  const prettierConfig = (await resolveConfig(catalogPath)) ?? {};
  return format(JSON.stringify(buildAtelierCatalog(source)), { ...prettierConfig, parser: 'json' });
}

export async function writeSpriteCatalog(): Promise<void> {
  const generated = await generatedSpriteCatalog();
  if ((await readFile(catalogPath, 'utf8')) !== generated) await writeFile(catalogPath, generated);
}

export async function checkSpriteCatalog(): Promise<void> {
  const current = await readFile(catalogPath, 'utf8');
  if (current !== (await generatedSpriteCatalog())) {
    throw new Error('packages/shared/sprite/catalog.json differs from the Atelier raster sources.');
  }
}
