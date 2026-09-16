import { describe, expect, it } from 'vitest';
import { checkSpriteCatalog } from '../scripts/sprite-catalog.ts';

describe('gemeinsamer Sprite-Katalog', () => {
  it('entspricht exakt den Atelier-Rasterquellen', async () => {
    await expect(checkSpriteCatalog()).resolves.toBeUndefined();
  });
});
