import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { DEFAULT_AVATARS } from '../../../apps/web/src/lib/defaultAvatars.ts';
import { characterSheet, type Character } from '../src/avatar.ts';

interface AtelierCatalog {
  avatars: Array<{
    key: string;
    url: string;
  }>;
}

interface AvatarManifest {
  avatars: Array<{
    key: string;
    spriteUrl: string;
  }>;
}

interface ProductSpec {
  avatars: Array<{
    key: string;
    recipe: Character;
  }>;
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const publicRoot = resolve(repositoryRoot, 'apps/web/public');
const catalogPath = resolve(publicRoot, 'assets/atelier/v1/catalog.json');

describe('atelier-v1 avatar activation drift', () => {
  // This belongs to the Node-side Asset Lab suite because it owns the generated
  // catalog and can verify checked-in public files without browser-only shims.
  it('keeps all six web defaults aligned with existing catalog assets', async () => {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as AtelierCatalog;
    const catalogByKey = new Map(catalog.avatars.map((avatar) => [avatar.key, avatar.url]));

    expect(DEFAULT_AVATARS.map((avatar) => avatar.key)).toEqual(catalog.avatars.map((avatar) => avatar.key));
    for (const avatar of DEFAULT_AVATARS) {
      expect(avatar.spriteUrl).toBe(catalogByKey.get(avatar.key));
      const assetPath = resolve(publicRoot, avatar.spriteUrl.replace(/^\//, ''));
      expect(relative(publicRoot, assetPath)).not.toMatch(/^\.\./);
      expect((await stat(assetPath)).isFile()).toBe(true);
    }
  });

  it('renders every frozen recipe pixel-identically to its checked-in sheet', async () => {
    const manifestPath = resolve(repositoryRoot, 'apps/server/prisma/seed-data/default-avatars/atelier-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as AvatarManifest;
    const productSpecPath = resolve(repositoryRoot, 'tools/asset-lab/product/atelier-v1.json');
    const productSpec = JSON.parse(await readFile(productSpecPath, 'utf8')) as ProductSpec;
    const recipes = new Map(productSpec.avatars.map((avatar) => [avatar.key, avatar.recipe]));

    expect(productSpec.avatars.map((avatar) => avatar.key)).toEqual(manifest.avatars.map((avatar) => avatar.key));
    for (const avatar of manifest.avatars) {
      const checkedIn = PNG.sync.read(await readFile(resolve(publicRoot, avatar.spriteUrl.replace(/^\//, ''))));
      const recipe = recipes.get(avatar.key);
      expect(recipe, avatar.key).toBeDefined();
      const rendered = characterSheet(recipe!);
      expect([checkedIn.width, checkedIn.height], avatar.key).toEqual([rendered.width, rendered.height]);
      expect(new Uint8ClampedArray(checkedIn.data), avatar.key).toEqual(rendered.data);
    }
  });
});
