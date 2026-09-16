import { readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATARS } from '../../../apps/web/src/lib/defaultAvatars.ts';

interface AtelierCatalog {
  avatars: Array<{
    key: string;
    url: string;
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
});
