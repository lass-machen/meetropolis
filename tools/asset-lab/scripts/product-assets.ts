import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { format as formatWithPrettier } from 'prettier';
import { assetDefinitions, buildAssets, directionalAssets, type AssetId } from '../src/assets.ts';
import { characterSheet } from '../src/avatar.ts';
import { loadProductSpec, type Point, type ProductAvatar, type ProductSpec } from './product-spec.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPRITE_WIDTH = 128;
const SPRITE_HEIGHT = 256;
const TERRAIN_ASSET_IDS = ['floor', 'carpet'] as const;
const STRUCTURE_ASSET_IDS = ['window', 'wall', 'door', 'door_open'] as const;
const TERRAIN_ASSET_ID_SET = new Set<AssetId>(TERRAIN_ASSET_IDS);
const STRUCTURE_ASSET_ID_SET = new Set<AssetId>(STRUCTURE_ASSET_IDS);

type EnvironmentCategory = 'terrain' | 'structures' | 'objects';
type RenderLayer = 'floor' | 'sorted' | 'overhead';

interface ProductFile {
  path: string;
  bytes: Buffer;
}

async function jsonBytes(value: unknown): Promise<Buffer> {
  return Buffer.from(await formatWithPrettier(JSON.stringify(value), { parser: 'json' }));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function encodePng(image: { width: number; height: number; data: Uint8ClampedArray }): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

function imagePath(root: string, id: string, bytes: Buffer): string {
  return `${root}/${id}.${sha256(bytes).slice(0, 12)}.png`;
}

function itemBase(spec: ProductSpec, id: AssetId, url: string) {
  const collisionBaseHeight = assetDefinitions[id].collisionBaseRows;
  return {
    id: `${spec.generation.replace('-', '_')}_${spec.palette.slug}_${id}`,
    key: assetDefinitions[id].name,
    dataURL: url,
    collide: collisionBaseHeight > 0,
    scaleFactor: 1,
    collisionBaseHeight,
    rotationAllowed: false,
    flipAllowed: false,
  };
}

function wallPlacement(spec: ProductSpec, id: AssetId): { anchor?: Point; offset?: Point } {
  if (!spec.wallPlacement.assetIds.includes(id)) return {};
  // Current clients ignore these fields. Stage 1A records a pixel anchor at the
  // top of the 16 px collision row and keeps the visual 32 px above the cell.
  return { anchor: spec.wallPlacement.anchor, offset: spec.wallPlacement.offset };
}

function directionalVariant(id: AssetId): { family: string; rotation: number } | null {
  for (const [family, variants] of Object.entries(directionalAssets)) {
    for (const [rotation, variantId] of Object.entries(variants)) {
      if (variantId === id) return { family, rotation: Number(rotation) };
    }
  }
  return null;
}

function environmentMetadata(
  spec: ProductSpec,
  id: AssetId,
): {
  category: EnvironmentCategory;
  collide: boolean;
  collisionBaseHeight: number;
  renderLayer: RenderLayer;
  directionalVariant: { family: string; rotation: number } | null;
} {
  if (id === spec.autotile.assetId) {
    // Autotile config has no pack-category, collision-base or render-layer fields.
    // Treat the withheld wall atlas conservatively as a colliding sorted structure;
    // collisionBaseHeight 0 means its full bounds collide when collide is true.
    return {
      category: 'structures',
      collide: true,
      collisionBaseHeight: 0,
      renderLayer: 'sorted',
      directionalVariant: null,
    };
  }
  const collisionBaseHeight = assetDefinitions[id].collisionBaseRows;
  const category: EnvironmentCategory = TERRAIN_ASSET_ID_SET.has(id)
    ? 'terrain'
    : STRUCTURE_ASSET_ID_SET.has(id)
      ? 'structures'
      : 'objects';
  const renderLayer: RenderLayer =
    category === 'terrain' ? 'floor' : spec.overheadAssets.includes(id) ? 'overhead' : 'sorted';
  return {
    category,
    collide: collisionBaseHeight > 0,
    collisionBaseHeight,
    renderLayer,
    directionalVariant: directionalVariant(id),
  };
}

function createPackManifest(spec: ProductSpec, urls: Record<AssetId, string>, dimensions: Record<AssetId, Point>) {
  const terrainIds = TERRAIN_ASSET_IDS;
  const structureIds = STRUCTURE_ASSET_IDS;
  const excluded = new Set<AssetId>([...terrainIds, ...structureIds, spec.autotile.assetId]);
  const objectIds = (Object.keys(assetDefinitions) as AssetId[]).filter((id) => !excluded.has(id)).sort();
  return {
    uuid: spec.palette.packUuid,
    name: `Atelier · ${spec.palette.name}`,
    version: spec.palette.packVersion,
    author: 'Tiamat UG (haftungsbeschränkt)',
    description: 'Eigene Pixelgrafiken der aktiven, unveränderlichen Atelier-Generation v1.',
    terrain: terrainIds.map((id) => ({
      ...itemBase(spec, id, urls[id]),
      category: 'terrain',
      placement: 'floor',
      renderLayer: 'floor',
      // The 32 px floor stays one deterministic 2 x 2 atlas on the 16 px world grid.
      tileWidth: id === spec.floorAtlas.assetId ? spec.floorAtlas.tileWidth : dimensions[id].x,
      tileHeight: id === spec.floorAtlas.assetId ? spec.floorAtlas.tileHeight : dimensions[id].y,
      margin: 0,
      spacing: 0,
    })),
    structures: structureIds.map((id) => ({
      ...itemBase(spec, id, urls[id]),
      category: 'structure',
      placement: 'wall',
      renderLayer: spec.overheadAssets.includes(id) ? 'overhead' : 'sorted',
      width: dimensions[id].x,
      height: dimensions[id].y,
      ...wallPlacement(spec, id),
    })),
    objects: objectIds.map((id) => ({
      ...itemBase(spec, id, urls[id]),
      category: 'objects',
      placement: spec.overheadAssets.includes(id) ? 'wall' : 'floor',
      renderLayer: spec.overheadAssets.includes(id) ? 'overhead' : 'sorted',
      width: dimensions[id].x,
      height: dimensions[id].y,
    })),
    // A28 must be closed before any global autotile becomes visible. The atlas
    // remains an immutable artifact and its complete contract lives in catalog.json.
    autotiles: [],
  };
}

function createDirectionalCatalog(spec: ProductSpec, dimensions: Record<AssetId, Point>) {
  if (spec.directionalStrategy !== 'separate-items') throw new Error('Unsupported directional strategy.');
  // Variant sizes differ, so each view is a non-rotatable item with its own dimensions.
  return Object.entries(directionalAssets).map(([family, variants]) => ({
    family,
    strategy: spec.directionalStrategy,
    variants: Object.entries(variants).map(([rotation, assetId]) => ({
      rotation: Number(rotation),
      itemId: `${spec.generation.replace('-', '_')}_${spec.palette.slug}_${assetId}`,
      width: dimensions[assetId].x,
      height: dimensions[assetId].y,
    })),
  }));
}

function validateProductDimensions(spec: ProductSpec, dimensions: Record<AssetId, Point>): void {
  const floor = dimensions[spec.floorAtlas.assetId];
  if (
    spec.floorAtlas.tileWidth !== spec.worldGrid.tileWidth ||
    spec.floorAtlas.tileHeight !== spec.worldGrid.tileHeight ||
    floor.x !== spec.floorAtlas.tileWidth * spec.floorAtlas.columns ||
    floor.y !== spec.floorAtlas.tileHeight * spec.floorAtlas.rows
  )
    throw new Error('The floor atlas does not match the declared world grid.');
  const wallHeight = spec.worldGrid.tileHeight * spec.wallPlacement.gridHeight;
  if (spec.wallPlacement.assetIds.some((id) => dimensions[id].y !== wallHeight))
    throw new Error('A wall asset does not match gridHeight.');
  if (spec.wallPlacement.anchor.y !== wallHeight - spec.worldGrid.tileHeight)
    throw new Error('The wall anchor must start the bottom collision row.');
  if (
    spec.wallPlacement.anchor.x !== 0 ||
    spec.wallPlacement.offset.x !== 0 ||
    spec.wallPlacement.offset.y !== -spec.wallPlacement.anchor.y
  )
    throw new Error('The wall offset must place its pixel anchor on the logical cell.');
  const autotile = dimensions[spec.autotile.assetId];
  if (spec.autotile.tileHeight !== wallHeight || autotile.x % spec.autotile.tileWidth || autotile.y % wallHeight)
    throw new Error('The withheld autotile does not match its grid contract.');
}

function createAvatarManifest(spec: ProductSpec, avatarFiles: Array<ProductAvatar & { url: string; sha256: string }>) {
  const states = {
    idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
    walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
  };
  return {
    schema: 'meetropolis-default-avatar-generation/v1',
    generation: spec.generation,
    active: spec.active,
    packUuid: 'default-characters',
    avatars: avatarFiles.map((avatar) => ({
      id: avatar.key,
      key: avatar.key,
      displayName: avatar.displayName,
      type: 'full',
      spriteUrl: avatar.url,
      sha256: avatar.sha256,
      frameWidth: 32,
      frameHeight: 32,
      columns: 4,
      rows: 8,
      states,
      look: avatar.look,
      recipe: avatar.recipe,
    })),
  };
}

export async function buildProductFiles(): Promise<ProductFile[]> {
  const spec = await loadProductSpec();
  const assets = buildAssets(spec.palette.theme);
  const environmentRoot = `apps/web/public/assets/atelier/v1/${spec.palette.slug}`;
  const spriteRoot = 'apps/web/public/assets/sprites/atelier-v1';
  const files: ProductFile[] = [];
  const urls = {} as Record<AssetId, string>;
  const dimensions = {} as Record<AssetId, Point>;
  const imageCatalog: Array<
    {
      id: AssetId;
      url: string;
      sha256: string;
      width: number;
      height: number;
    } & ReturnType<typeof environmentMetadata>
  > = [];
  for (const id of (Object.keys(assets) as AssetId[]).sort()) {
    const image = assets[id];
    const bytes = encodePng(image);
    const path = imagePath(environmentRoot, id, bytes);
    urls[id] = `/${path.replace('apps/web/public/', '')}`;
    dimensions[id] = { x: image.width, y: image.height };
    imageCatalog.push({
      id,
      url: urls[id],
      sha256: sha256(bytes),
      width: image.width,
      height: image.height,
      ...environmentMetadata(spec, id),
    });
    files.push({ path, bytes });
  }
  validateProductDimensions(spec, dimensions);
  const avatarFiles = spec.avatars.map((avatar) => {
    const image = characterSheet(avatar.recipe);
    if (image.width !== SPRITE_WIDTH || image.height !== SPRITE_HEIGHT)
      throw new Error(`${avatar.key} has invalid sheet dimensions.`);
    const bytes = encodePng(image);
    const path = imagePath(spriteRoot, avatar.key, bytes);
    files.push({ path, bytes });
    return { ...avatar, url: `/${path.replace('apps/web/public/', '')}`, sha256: sha256(bytes) };
  });
  const packManifest = createPackManifest(spec, urls, dimensions);
  const packManifestPath = `apps/server/prisma/seed-data/asset-packs/${spec.generation}/${spec.palette.slug}.json`;
  const avatarManifestPath = `apps/server/prisma/seed-data/default-avatars/${spec.generation}.json`;
  files.push({ path: packManifestPath, bytes: await jsonBytes(packManifest) });
  files.push({ path: avatarManifestPath, bytes: await jsonBytes(createAvatarManifest(spec, avatarFiles)) });
  const catalog = {
    schema: 'meetropolis-product-asset-catalog/v1',
    generation: spec.generation,
    active: spec.active,
    palette: spec.palette,
    atelierOnlyThemes: spec.atelierOnlyThemes,
    worldGrid: spec.worldGrid,
    manifest: packManifestPath,
    environmentAssets: imageCatalog,
    floorAtlas: { ...spec.floorAtlas, sourceWidth: dimensions.floor.x, sourceHeight: dimensions.floor.y },
    directionalFamilies: createDirectionalCatalog(spec, dimensions),
    wallPlacement: { ...spec.wallPlacement, coordinateSpace: 'source-pixels' },
    withheldAutotile: {
      ...spec.autotile,
      url: urls[spec.autotile.assetId],
      anchor: spec.wallPlacement.anchor,
      offset: spec.wallPlacement.offset,
    },
    avatarManifest: avatarManifestPath,
    avatars: avatarFiles.map((avatar) => ({
      key: avatar.key,
      displayName: avatar.displayName,
      look: avatar.look,
      url: avatar.url,
      sha256: avatar.sha256,
    })),
  };
  const catalogPath = 'apps/web/public/assets/atelier/v1/catalog.json';
  files.push({ path: catalogPath, bytes: await jsonBytes(catalog) });
  files.push({
    path: 'apps/web/public/assets/atelier/v1/LICENSE.txt',
    bytes: await readFile(fileURLToPath(new URL('../LICENSE', import.meta.url))),
  });
  const sums = files
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${sha256(file.bytes)}  ${file.path}`)
    .join('\n');
  files.push({ path: 'apps/web/public/assets/atelier/v1/SHA256SUMS', bytes: Buffer.from(`${sums}\n`) });
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeFiles(root: string, files: ProductFile[], immutable: boolean): Promise<void> {
  for (const file of files) {
    const destination = resolve(root, file.path);
    if (relative(root, destination).startsWith('..')) throw new Error(`Unsafe product path: ${file.path}`);
    await mkdir(dirname(destination), { recursive: true });
    if (immutable) {
      const existing = await readOptionalFile(destination);
      if (existing && !existing.equals(file.bytes))
        throw new Error(`${file.path} already exists with different bytes; create a new generation.`);
    }
    await writeFile(destination, file.bytes);
  }
}

async function readOptionalFile(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function listFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
}

async function assertNoUnexpectedFiles(files: ProductFile[], roots: string[]): Promise<void> {
  const generatedPaths = new Set(files.map((file) => file.path));
  for (const root of roots) {
    for (const existing of await listFiles(resolve(REPOSITORY_ROOT, root))) {
      const path = relative(REPOSITORY_ROOT, existing);
      if (root.endsWith('default-avatars') && path !== 'apps/server/prisma/seed-data/default-avatars/atelier-v1.json')
        continue;
      if (!generatedPaths.has(path)) throw new Error(`Unexpected checked-in product artifact: ${path}`);
    }
  }
}

export async function exportProductAssets(): Promise<ProductFile[]> {
  const files = await buildProductFiles();
  await writeFiles(REPOSITORY_ROOT, files, true);
  return files;
}

export async function checkProductAssets(): Promise<ProductFile[]> {
  const files = await buildProductFiles();
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'meetropolis-product-assets-'));
  try {
    await writeFiles(temporaryRoot, files, false);
    const roots = [
      'apps/web/public/assets/atelier/v1',
      'apps/web/public/assets/sprites/atelier-v1',
      'apps/server/prisma/seed-data/asset-packs/atelier-v1',
      'apps/server/prisma/seed-data/default-avatars',
    ];
    await assertNoUnexpectedFiles(files, roots);
    for (const file of files) {
      const expected = await readFile(resolve(temporaryRoot, file.path));
      const actual = await readOptionalFile(resolve(REPOSITORY_ROOT, file.path));
      if (!actual || !actual.equals(expected)) throw new Error(`Product artifact differs: ${file.path}`);
    }
    return files;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
