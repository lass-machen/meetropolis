import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../../../apps/server/src/api/routes/assetPacks.schemas.ts';
import { directionalAssets } from '../src/assets.ts';
import { buildProductFiles } from '../scripts/product-assets.ts';
import { loadProductSpec } from '../scripts/product-spec.ts';

type JsonRecord = Record<string, unknown>;

async function generated() {
  const files = await buildProductFiles();
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  const json = (suffix: string): JsonRecord => {
    const entry = files.find((file) => file.path.endsWith(suffix));
    if (!entry) throw new Error(`Missing generated file: ${suffix}`);
    return JSON.parse(entry.bytes.toString()) as JsonRecord;
  };
  return { files, byPath, json };
}

function importablePack(pack: JsonRecord): JsonRecord {
  const clone = structuredClone(pack);
  for (const category of ['terrain', 'structures', 'objects', 'autotiles']) {
    const items = clone[category];
    if (!Array.isArray(items)) continue;
    for (const item of items as JsonRecord[]) {
      if (typeof item.dataURL === 'string') item.dataURL = item.dataURL.replace(/^\//, '');
    }
  }
  return clone;
}

describe('Produktgeneration atelier-v1', () => {
  it('friert nur Licht und Holz sowie die sechs stabilen Avatar-Keys ein', async () => {
    const spec = await loadProductSpec();
    expect(spec.active).toBe(false);
    expect(spec.palette).toMatchObject({ theme: 'holz', slug: 'holz' });
    expect(spec.atelierOnlyThemes).toEqual(['garten', 'abend']);
    expect(spec.avatars.map((avatar) => avatar.key)).toEqual([
      'business_man',
      'business_woman',
      'casual_woman',
      'dev_hoodie',
      'manager_woman',
      'suit_man',
    ]);
    expect(spec.avatars.every((avatar) => avatar.recipe.face && avatar.recipe.proportion)).toBe(true);
  });

  it('normalisiert Raster, Richtungen, Kollision, Ebenen und Wandanker', async () => {
    const { json } = await generated();
    const pack = json('/asset-packs/atelier-v1/holz.json');
    const parsed = ConfigSchema.parse(importablePack(pack));
    expect(parsed.uuid).toBe('4664b745-6bad-4d86-ae8f-591c57567692');
    expect(parsed.autotiles).toEqual([]);
    const floor = parsed.terrain.find((item) => item.id.endsWith('_floor'))!;
    expect([floor.tileWidth, floor.tileHeight]).toEqual([16, 16]);
    expect(floor.renderLayer).toBe('floor');
    for (const item of [...parsed.structures, ...parsed.objects]) {
      expect(item.collisionBaseHeight).toBeTypeOf('number');
      expect(item.renderLayer).toMatch(/^(sorted|overhead)$/);
      expect(item.directionalImages).toBeUndefined();
      expect(item.rotationAllowed).toBe(false);
    }
    for (const id of ['wall', 'door', 'door_open']) {
      const item = parsed.structures.find((candidate) => candidate.id.endsWith(`_${id}`))!;
      expect(item.anchor).toEqual({ x: 0, y: 32 });
      expect(item.offset).toEqual({ x: 0, y: -32 });
    }
    const catalog = json('/assets/atelier/v1/catalog.json');
    expect(catalog.withheldAutotile).toMatchObject({ active: false, blockedBy: 'A28', gridHeight: 3 });
    const families = catalog.directionalFamilies as Array<{
      variants: Array<{ itemId: string; width: number; height: number }>;
    }>;
    expect(families).toHaveLength(Object.keys(directionalAssets).length);
    expect(families.flatMap((family) => family.variants).every((item) => item.width > 0 && item.height > 0)).toBe(true);
  });

  it('erzeugt 59 gehashte Umgebungsbilder und sechs gültige Spritesheets', async () => {
    const { files, byPath, json } = await generated();
    const environment = files.filter((file) => file.path.match(/assets\/atelier\/v1\/holz\/.*\.png$/));
    const sprites = files.filter((file) => file.path.match(/assets\/sprites\/atelier-v1\/.*\.png$/));
    expect(environment).toHaveLength(59);
    expect(sprites).toHaveLength(6);
    expect(files.some((file) => file.path.includes('/garten/') || file.path.includes('/abend/'))).toBe(false);
    for (const file of [...environment, ...sprites]) {
      const hash = createHash('sha256').update(file.bytes).digest('hex');
      expect(file.path).toContain(`.${hash.slice(0, 12)}.png`);
      const image = PNG.sync.read(file.bytes);
      if (sprites.includes(file)) expect([image.width, image.height]).toEqual([128, 256]);
    }
    const avatarManifest = json('/default-avatars/atelier-v1.json');
    expect(avatarManifest.active).toBe(false);
    for (const avatar of avatarManifest.avatars as Array<{ spriteUrl: string; sha256: string }>) {
      const path = `apps/web/public${avatar.spriteUrl}`;
      expect(createHash('sha256').update(byPath.get(path)!).digest('hex')).toBe(avatar.sha256);
    }
  });

  it('enthält keine alten Laufzeitpfade oder Atelier-Pack-UUIDs', async () => {
    const { files } = await generated();
    const generatedText = files
      .filter((file) => file.path.endsWith('.json') || file.path.endsWith('SHA256SUMS'))
      .map((file) => file.bytes.toString())
      .join('\n');
    expect(generatedText).not.toContain('/assets/furniture/');
    expect(generatedText).not.toContain('/assets/sprites/business_man.png');
    expect(generatedText).not.toContain('42612c0c-1580-4bfb-b954-207a7a4a10b');
  });
});
