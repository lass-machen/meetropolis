import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../db.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { runTenantExport } from './run.js';
import { OSS_EXPORT_SPECS } from './spec.js';

/**
 * Tenant export isolation across two tenants (real PostgreSQL, no mocks).
 *
 * Seeds tenants A and B with parallel rows, exports only A through
 * `runTenantExport`, and proves the export directory holds no trace of B:
 * every row carrying a tenant id belongs to A, no file mentions B, the
 * manifest counts match the database, every checksum verifies, and the TMJ
 * document of A's map parses. Runs only in the `server-db` vitest project
 * (see `apps/server/vitest.config.ts`); the `server` unit project excludes
 * every `*.integration.test.ts` file.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tenantExport.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma: PrismaClient = createPrismaClient();

const suffix = crypto.randomUUID().replace(/-/g, '');
const slugA = `o5a-${suffix}`;
const slugB = `o5b-${suffix}`;
const sharedEmail = `o5-shared-${suffix}@example.test`;
const onlyBEmail = `o5-onlyb-${suffix}@example.test`;
const tileBaseA = `o5tile-a-${suffix}.png`;
const tileBaseB = `o5tile-b-${suffix}.png`;

/** Every secret or B-side value that must not appear in any output file. */
const needles: string[] = [];

function plain(purpose: string, tag: string): string {
  return `o5-${suffix}-${purpose}-${tag}`;
}

function marker(purpose: string, tag: string): string {
  const value = plain(purpose, tag);
  needles.push(value);
  return value;
}

function leakProbe(value: string): string {
  needles.push(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function readJsonArrayFile(filePath: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isUnknownArray(parsed)) {
    throw new Error(`expected a JSON array in ${filePath}`);
  }
  return parsed;
}

function listExportFiles(outDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(outDir, '');
  return found.sort();
}

interface ManifestTable {
  model: string;
  file: string;
  rows: number;
}

function readManifestTables(outDir: string): { tables: ManifestTable[]; tilesetsNotFound: string[] } {
  const parsed: unknown = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('manifest.json is not an object');
  }
  if (!isUnknownArray(parsed.tables) || !isRecord(parsed.files) || !isUnknownArray(parsed.files.tilesetsNotFound)) {
    throw new Error('manifest.json has an unexpected shape');
  }
  const tables: ManifestTable[] = [];
  for (const entry of parsed.tables) {
    if (
      !isRecord(entry) ||
      typeof entry.model !== 'string' ||
      typeof entry.file !== 'string' ||
      typeof entry.rows !== 'number'
    ) {
      throw new Error('manifest.json table entry has an unexpected shape');
    }
    tables.push({ model: entry.model, file: entry.file, rows: entry.rows });
  }
  const tilesetsNotFound: string[] = [];
  for (const name of parsed.files.tilesetsNotFound) {
    if (typeof name !== 'string') {
      throw new Error('manifest.json tilesetsNotFound entry is not a string');
    }
    tilesetsNotFound.push(name);
  }
  return { tables, tilesetsNotFound };
}

interface CountQuery {
  where: Record<string, unknown>;
}

/** Reads one Prisma count delegate behind runtime checks (no static cast of rows). */
function readCountDelegate(prismaClient: PrismaClient, delegate: string): (query: CountQuery) => Promise<number> {
  const table: unknown = prismaClient[delegate as keyof PrismaClient];
  if (typeof table !== 'object' || table === null) {
    throw new Error(`unknown export delegate: ${delegate}`);
  }
  const candidate = table as { count?: unknown };
  if (typeof candidate.count !== 'function') {
    throw new Error(`unknown export delegate: ${delegate}`);
  }
  const count: unknown = candidate.count;
  return (query) => (count as (query: CountQuery) => Promise<number>)(query);
}

function writeSeedFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

const seedIds = {
  tenantA: '',
  tenantB: '',
  mapA: '',
  mapB: '',
  users: [] as string[],
  memberships: [] as string[],
  layers: [] as string[],
  npcs: [] as string[],
};

let packsRoot = '';
let npcRoot = '';
let tmpBase = '';
let outDir = '';
const savedPacksDir = process.env.ASSET_PACKS_DIR;
const savedNpcMediaDir = process.env.NPC_MEDIA_DIR;

const diskContent = {
  packA: plain('packfile', 'a'),
  avatarA: plain('avatarfile', 'a'),
  customA: plain('customavatar', 'a'),
  npcA: plain('npcmedia', 'a'),
  packB: leakProbe(`o5-${suffix}-packfile-b`),
  avatarB: leakProbe(`o5-${suffix}-avatarfile-b`),
  npcB: leakProbe(`o5-${suffix}-npcmedia-b`),
};

async function seedTenantSide(tag: 'a' | 'b', slug: string, userId: string, role: 'member' | 'owner'): Promise<void> {
  const isA = tag === 'a';
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  const tenantId = tenant.id;
  if (isA) {
    seedIds.tenantA = tenantId;
  } else {
    seedIds.tenantB = tenantId;
  }
  const membership = await prisma.membership.create({ data: { userId, tenantId, role } });
  seedIds.memberships.push(membership.id);
  await prisma.invite.create({ data: { tenantId, code: marker('invite', tag) } });
  const map = await prisma.map.create({
    data: {
      tenantId,
      name: `office-${tag}`,
      meta: { spawn: { x: 64, y: 64 } },
      width: 4,
      height: 4,
      tileWidth: 32,
      tileHeight: 32,
    },
  });
  if (isA) {
    seedIds.mapA = map.id;
  } else {
    seedIds.mapB = map.id;
  }
  const layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: 'ground', chunkSize: 32 } });
  seedIds.layers.push(layer.id);
  await prisma.mapChunk.create({
    data: {
      layerId: layer.id,
      x: 0,
      y: 0,
      version: 1,
      encoding: 'rle',
      data: Buffer.from(isA ? [1, 0, 7] : [2, 0, 9]),
    },
  });
  await prisma.mapTileset.create({
    data: {
      mapId: map.id,
      slot: 0,
      key: `tiles-${tag}`,
      imageUrl: `/assets/tilesets/${isA ? tileBaseA : tileBaseB}`,
      tileWidth: 32,
      tileHeight: 32,
      hash: isA ? plain('tilesethash', tag) : marker('tilesethash', tag),
    },
  });
  await prisma.mapAutotile.create({
    data: {
      mapId: map.id,
      slot: 1,
      packUuid: `o5-pack-${tag}-${suffix}`,
      autotileId: `auto-${tag}`,
      key: `autotile-${tag}`,
      imageUrl: `/packs/auto-${tag}.png`,
      tileWidth: 32,
      tileHeight: 32,
      gridHeight: 48,
      variants: [],
      collide: false,
      placement: 'ground',
      hash: isA ? plain('autotilehash', tag) : marker('autotilehash', tag),
    },
  });
  await prisma.mapObject.create({
    data: {
      mapId: map.id,
      assetPackUuid: `o5-pack-${tag}-${suffix}`,
      itemId: `item-${tag}`,
      category: 'objects',
      tileX: 1,
      tileY: 1,
      chunkX: 0,
      chunkY: 0,
      width: 1,
      height: 1,
      dataUrl: `/packs/item-${tag}.png`,
    },
  });
  const room = await prisma.room.create({ data: { tenantId, mapId: map.id, name: `lobby-${tag}` } });
  await prisma.zone.create({
    data: {
      tenantId,
      mapId: map.id,
      roomId: room.id,
      name: `zone-${tag}`,
      polygon: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 80 },
        { x: 0, y: 80 },
      ],
    },
  });
  await prisma.presence.create({ data: { userId, roomId: room.id, tenantId, x: 10, y: 20, direction: 'down' } });
  const npc = await prisma.npc.create({ data: { tenantId, identity: `greeter-${tag}`, name: `Greeter ${tag}` } });
  seedIds.npcs.push(npc.id);
  await prisma.npcMediaFile.create({
    data: {
      npcId: npc.id,
      filename: `clip-${tag}.bin`,
      storagePath: `${slug}/clip-${tag}.bin`,
      mimeType: 'video/mp4',
      sizeBytes: 12,
      mediaType: 'video',
    },
  });
  const assetUuid = crypto.randomUUID();
  await prisma.assetPack.create({
    data: {
      uuid: assetUuid,
      tenantId,
      name: `pack-${tag}`,
      description: `pack ${tag}`,
      author: 'export probe',
      version: '1.0.0',
      terrain: {},
      structures: {},
      objects: {},
    },
  });
  const avatarUuid = crypto.randomUUID();
  await prisma.avatarPack.create({
    data: {
      uuid: avatarUuid,
      tenantId,
      name: `avatars-${tag}`,
      description: `avatars ${tag}`,
      author: 'export probe',
      version: '1.0.0',
      avatars: [],
    },
  });
  writeSeedFile(path.join(packsRoot, assetUuid, 'tile.txt'), isA ? diskContent.packA : diskContent.packB);
  writeSeedFile(
    path.join(packsRoot, 'avatars', avatarUuid, 'avatar.txt'),
    isA ? diskContent.avatarA : diskContent.avatarB,
  );
  writeSeedFile(path.join(npcRoot, slug, `clip-${tag}.bin`), isA ? diskContent.npcA : diskContent.npcB);
}

beforeAll(async () => {
  tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-export-isolation-'));
  packsRoot = path.join(tmpBase, 'packs');
  npcRoot = path.join(tmpBase, 'npc-media');
  outDir = path.join(tmpBase, 'out');
  process.env.ASSET_PACKS_DIR = packsRoot;
  process.env.NPC_MEDIA_DIR = npcRoot;

  const shared = await prisma.user.create({
    data: { email: sharedEmail, name: 'Shared', passwordHash: marker('passwordhash', 'shared'), locale: 'de' },
  });
  const onlyB = await prisma.user.create({
    data: { email: onlyBEmail, name: 'Only B', passwordHash: marker('passwordhash', 'onlyb'), locale: 'de' },
  });
  seedIds.users.push(shared.id, onlyB.id);

  await seedTenantSide('a', slugA, shared.id, 'owner');
  await seedTenantSide('b', slugB, shared.id, 'member');
  const onlyBMembership = await prisma.membership.create({
    data: { userId: onlyB.id, tenantId: seedIds.tenantB, role: 'member' },
  });
  seedIds.memberships.push(onlyBMembership.id);

  const customUuid = crypto.randomUUID();
  await prisma.customAvatar.create({
    data: {
      uuid: customUuid,
      userId: shared.id,
      tenantId: seedIds.tenantA,
      config: { version: 1 },
      spriteUrl: `/packs/avatars/custom/${customUuid}.png`,
      configHash: plain('confighash', 'a'),
    },
  });
  writeSeedFile(path.join(packsRoot, 'avatars', 'custom', `${customUuid}.png`), diskContent.customA);
  writeSeedFile(path.join(packsRoot, 'avatars', 'custom', `${customUuid}_p.png`), diskContent.customA);

  for (const [userId, tag] of [
    [shared.id, 'shared'],
    [onlyB.id, 'onlyb'],
  ] as const) {
    await prisma.session.create({
      data: { userId, tokenHash: marker('session', tag), expiresAt: new Date(Date.now() + 3600000) },
    });
    await prisma.apiToken.create({ data: { userId, hash: marker('apitoken', tag), name: 'export probe' } });
    await prisma.passwordReset.create({
      data: { userId, token: marker('passwordreset', tag), expiresAt: new Date(Date.now() + 3600000) },
    });
  }
  const guestMemberships = [seedIds.memberships[0] ?? '', seedIds.memberships[2] ?? ''];
  const guestTags = ['guesta', 'guestb'] as const;
  for (const [index, membershipId] of guestMemberships.entries()) {
    await prisma.guestToken.create({
      data: {
        membershipId,
        token: marker('guesttoken', guestTags[index] ?? 'guest'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }

  leakProbe(seedIds.tenantB);
  leakProbe(slugB);
  leakProbe(seedIds.mapB);
  leakProbe(onlyBEmail);

  await runTenantExport({
    prisma,
    slug: slugA,
    outDir,
    hooks: { adminLoaded: false, transcriptionLoaded: false },
    log: () => {},
  });
}, 120000);

afterAll(async () => {
  if (savedPacksDir === undefined) {
    delete process.env.ASSET_PACKS_DIR;
  } else {
    process.env.ASSET_PACKS_DIR = savedPacksDir;
  }
  if (savedNpcMediaDir === undefined) {
    delete process.env.NPC_MEDIA_DIR;
  } else {
    process.env.NPC_MEDIA_DIR = savedNpcMediaDir;
  }
  if (tmpBase.length > 0) {
    await fsp.rm(tmpBase, { recursive: true, force: true });
    tmpBase = '';
  }
  const tenantIds = [seedIds.tenantA, seedIds.tenantB].filter((id) => id.length > 0);
  const userIds = seedIds.users;
  try {
    await prisma.guestToken.deleteMany({ where: { membershipId: { in: seedIds.memberships } } });
    await prisma.passwordReset.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.zone.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.npcMediaFile.deleteMany({ where: { npcId: { in: seedIds.npcs } } });
    await prisma.npc.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.mapObject.deleteMany({ where: { mapId: { in: [seedIds.mapA, seedIds.mapB] } } });
    await prisma.mapChunk.deleteMany({ where: { layerId: { in: seedIds.layers } } });
    await prisma.mapLayer.deleteMany({ where: { mapId: { in: [seedIds.mapA, seedIds.mapB] } } });
    await prisma.mapAutotile.deleteMany({ where: { mapId: { in: [seedIds.mapA, seedIds.mapB] } } });
    await prisma.mapTileset.deleteMany({ where: { mapId: { in: [seedIds.mapA, seedIds.mapB] } } });
    await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.map.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.invite.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.customAvatar.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.assetPack.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.avatarPack.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('tenant export isolation across two tenants', () => {
  it('exports only rows of tenant A wherever a tenant id is present', () => {
    const dbFiles = listExportFiles(outDir).filter((file) => file.startsWith('db/') && file.endsWith('.json'));
    expect(dbFiles.length).toBeGreaterThan(0);
    let checked = 0;
    for (const file of dbFiles) {
      for (const entry of readJsonArrayFile(path.join(outDir, file))) {
        if (!isRecord(entry)) {
          throw new Error(`expected row objects in ${file}`);
        }
        if (typeof entry.tenantId === 'string') {
          expect(entry.tenantId, `tenant leak in ${file}`).toBe(seedIds.tenantA);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('mentions no B-side id, email, file content, or secret marker in any output file', () => {
    expect(needles.length).toBeGreaterThan(0);
    for (const file of listExportFiles(outDir)) {
      const content = readFileSync(path.join(outDir, file), 'utf8');
      for (const needle of needles) {
        expect(content.includes(needle), `${needle} leaked into ${file}`).toBe(false);
      }
    }
  });

  it('reports the database row count of tenant A for every exported table', async () => {
    const { tables } = readManifestTables(outDir);
    expect(tables.length).toBe(OSS_EXPORT_SPECS.length);
    for (const spec of OSS_EXPORT_SPECS) {
      const count = readCountDelegate(prisma, spec.delegate);
      const expected = await count({ where: spec.where(seedIds.tenantA) });
      const entry = tables.find((table) => table.model === spec.model);
      expect(entry, `manifest entry for ${spec.model}`).toBeDefined();
      expect(entry?.rows, `row count for ${spec.model}`).toBe(expected);
    }
  });

  it('ships a SHA256SUMS file whose lines match freshly computed hashes', () => {
    const lines = readFileSync(path.join(outDir, 'SHA256SUMS'), 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const listed = new Map<string, string>();
    for (const line of lines) {
      const parts = line.split('  ');
      expect(parts.length, `malformed checksum line: ${line}`).toBe(2);
      const [hex, rel] = parts as [string, string];
      expect(hex, `malformed sha256 for ${rel}`).toMatch(/^[0-9a-f]{64}$/);
      listed.set(rel, hex);
      const actual = createHash('sha256')
        .update(readFileSync(path.join(outDir, rel)))
        .digest('hex');
      expect(actual, `checksum mismatch for ${rel}`).toBe(hex);
    }
    const expectedFiles = listExportFiles(outDir)
      .filter((file) => file !== 'SHA256SUMS')
      .sort();
    expect([...listed.keys()].sort()).toEqual(expectedFiles);
  });

  it('copies the pack file, the npc medium, and the custom avatar of tenant A', () => {
    const packFiles = listExportFiles(outDir).filter(
      (file) => file.startsWith('files/packs/') && file.endsWith('/tile.txt'),
    );
    expect(packFiles.length).toBe(1);
    expect(readFileSync(path.join(outDir, packFiles[0] ?? ''), 'utf8')).toBe(diskContent.packA);
    const avatarFiles = listExportFiles(outDir).filter(
      (file) => file.startsWith('files/avatars/') && file.endsWith('/avatar.txt'),
    );
    expect(avatarFiles.length).toBe(1);
    expect(readFileSync(path.join(outDir, avatarFiles[0] ?? ''), 'utf8')).toBe(diskContent.avatarA);
    const customFiles = listExportFiles(outDir)
      .filter((file) => file.startsWith('files/custom-avatars/'))
      .sort();
    expect(customFiles.length).toBe(2);
    for (const file of customFiles) {
      expect(readFileSync(path.join(outDir, file), 'utf8')).toBe(diskContent.customA);
    }
    const npcFiles = listExportFiles(outDir).filter((file) => file.startsWith('files/npc-media/'));
    expect(npcFiles.length).toBe(1);
    expect(npcFiles[0]?.startsWith(`files/npc-media/${slugA}/`)).toBe(true);
    expect(readFileSync(path.join(outDir, npcFiles[0] ?? ''), 'utf8')).toBe(diskContent.npcA);
    const { tilesetsNotFound } = readManifestTables(outDir);
    expect(tilesetsNotFound).toContain(tileBaseA);
  });

  it('exports the shared user allowlisted and no membership of tenant B', () => {
    const users = readJsonArrayFile(path.join(outDir, 'db/User.json'));
    expect(users.length).toBe(1);
    const shared = users[0];
    if (!isRecord(shared)) {
      throw new Error('expected a user object in db/User.json');
    }
    expect(shared.email).toBe(sharedEmail);
    expect(Object.keys(shared).sort()).toEqual(['createdAt', 'email', 'id', 'imageUrl', 'locale', 'name']);
    const memberships = readJsonArrayFile(path.join(outDir, 'db/Membership.json'));
    expect(memberships.length).toBe(1);
    const membership = memberships[0];
    if (!isRecord(membership)) {
      throw new Error('expected a membership object in db/Membership.json');
    }
    expect(membership.tenantId).toBe(seedIds.tenantA);
  });

  it('writes a parseable TMJ document for the map of tenant A', () => {
    const tmjPath = path.join(outDir, `maps/${seedIds.mapA}.tmj`);
    const parsed: unknown = JSON.parse(readFileSync(tmjPath, 'utf8'));
    expect(isRecord(parsed)).toBe(true);
  });
});
