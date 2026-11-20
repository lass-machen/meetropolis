import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkSpriteCatalog } from '../scripts/sprite-catalog.ts';
import { buildAtelierCatalog } from '../src/avatar-catalog.ts';

const v6CatalogUrl = new URL('../../../packages/shared/sprite/catalog.json', import.meta.url);
const oldNotice =
  'Generated output of tools/sprite-generator (the generator sources are SPDX: AGPL-3.0-only). ' +
  'Tiamat UG holds the copyright in both the generator and this output and licenses this generated file ' +
  'under MIT, consistent with the @meetropolis/shared package it ships in. The generator itself stays ' +
  'AGPL-3.0-only. See packages/shared/sprite/NOTICE.';
const expectedNotice =
  'Generated via tools/asset-lab (buildAtelierCatalog) from the existing catalog plus Atelier raster additions. ' +
  'Pixel basis: tools/sprite-generator. Tiamat UG holds the copyright in both the Python generator and this output; ' +
  'this generated file is licensed under MIT, consistent with @meetropolis/shared. The Python generator remains ' +
  'AGPL-3.0-only. See packages/shared/sprite/NOTICE.';

describe('gemeinsamer Sprite-Katalog', () => {
  it('entspricht exakt den Atelier-Rasterquellen', async () => {
    await expect(checkSpriteCatalog()).resolves.toBeUndefined();
  });

  it('replaces the inherited Python notice with the v6 provenance notice', async () => {
    const input = JSON.parse(await readFile(v6CatalogUrl, 'utf8')) as Record<string, unknown>;
    input.notice = oldNotice;
    const snapshot = structuredClone(input);
    const output = buildAtelierCatalog(input);
    expect((output as { notice?: unknown }).notice).toBe(expectedNotice);
    expect(output.schema).toBe('meetropolis-sprite-catalog/v6');
    expect({ ...output, notice: undefined }).toEqual({ ...snapshot, notice: undefined });
    expect(input).toEqual(snapshot);
  });
});
