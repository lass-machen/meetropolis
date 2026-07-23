import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { importTmjIntoMap } from '../src/scripts/importMapV2.lib.js';
import { resolveTemplateTenantSlug } from '../src/services/templateTenant.js';

// Prisma 7 requires a driver-adapter. The seed runs via `prisma db seed`
// (outside the application's normal entrypoint) so we construct one here.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Static web assets the seed reads at runtime. They live in the web workspace
// and are copied into the seed stage by dockerfiles/server.Dockerfile.
// seedDir = <repo>/apps/server/prisma, so the repo root is three levels up.
const seedDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(seedDir, '..', '..', '..');
const furnitureDir = path.join(repoRoot, 'apps', 'web', 'public', 'assets', 'furniture');
const officeTmjPath = path.join(repoRoot, 'apps', 'web', 'public', 'maps', 'office.json');

/**
 * Create a tenant's starter map from the bundled office TMJ template.
 *
 * CALLERS MUST GUARANTEE THAT THE MAP ROW DOES NOT EXIST YET. `importTmjIntoMap`
 * is destructive — it rebuilds tilesets, layers, chunks and objects with
 * `deleteMany` — so running it against a map an operator has already edited in
 * the map editor would silently discard that editorial work. The template map
 * is content, not a shipped library: create when missing, never overwrite.
 *
 * `allowEmptyFallback` decides what a missing or unreadable TMJ costs:
 *
 * - `true` (the `default` workspace): log loudly, fall back to an empty 32x32
 *   map so the frontend's /maps/<id>/* calls resolve instead of 404-ing, and
 *   let the remaining seed steps run.
 * - `false` (the TEMPLATE tenant): abort. The empty fallback would be
 *   IRREVERSIBLE there — the caller only imports "when the map is missing", so
 *   every later deploy skips the import, and re-running `importTmjIntoMap` by
 *   hand is destructive against a blueprint the operator may have edited in the
 *   meantime. One broken image build would pin every future customer's starter
 *   world to an empty map.
 *
 * What a non-zero exit COSTS, so nobody mistakes it for a mere log line: a
 * deployment that gates the API on the seed (`depends_on: seed: { condition:
 * service_completed_successfully }`, which the Tiamat production stack does)
 * will not start `server` until the seed succeeds. That is the intended
 * fail-closed trade — an empty blueprint is unrecoverable, a stalled deploy is
 * not — but it makes the seed a release gate: run it and CHECK ITS EXIT CODE
 * before recreating the API container. This repository's own compose.yaml ends
 * the migrate/seed step in `|| true` and therefore swallows the throw: a
 * self-hosted stack keeps running, the template tenant simply stays without a
 * map, and the next deploy retries the import.
 */
async function createStarterMap(tenantId: string, mapName: string, allowEmptyFallback: boolean) {
  if (!fs.existsSync(officeTmjPath)) {
    const message =
      `SEED: office template missing at ${officeTmjPath}. ` +
      'Check that the image build copies apps/web/public into the seed stage.';
    if (!allowEmptyFallback) throw new Error(message);
    console.error(`${message} The tenant gets an EMPTY starter map.`);
  } else {
    try {
      const result = await importTmjIntoMap(prisma, tenantId, mapName, officeTmjPath, 32);
      console.log(
        `Imported office template into '${mapName}': ${result.objectsCreated} objects, mapId=${result.mapId}`,
      );
    } catch (err) {
      if (!allowEmptyFallback) throw err;
      // Do not rethrow: the remaining seed steps (packs, admin, invite) are
      // independent and still worth running. The import may have created a
      // partial map row, so the lookup below decides whether to fall back.
      console.error(`SEED: office template import failed for map '${mapName}':`, err);
    }
  }

  const imported = await prisma.map.findUnique({ where: { tenantId_name: { tenantId, name: mapName } } });
  if (imported) return imported;

  if (!allowEmptyFallback) {
    throw new Error(
      `SEED: template import produced no map row for '${mapName}'; refusing to write an empty blueprint.`,
    );
  }
  return prisma.map.create({
    data: { tenantId, name: mapName, meta: {}, width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 },
  });
}

/** Ensure a map has a lobby room, matching the adminMaps create flow. */
async function ensureLobbyRoom(tenantId: string, mapId: string) {
  const existing = await prisma.room.findFirst({ where: { mapId, name: 'lobby' } });
  if (existing) return;
  await prisma.room.create({ data: { name: 'lobby', mapId, tenantId } });

  console.log('Seeded lobby room for map:', mapId);
}

async function main() {
  // Ensure tenants exist
  const internal = await prisma.tenant.upsert({
    where: { slug: 'internal' },
    create: {
      slug: 'internal',
      name: 'Internal',
      concurrentLimit: 999999,
      bypassLimits: true,
      isInternal: true,
      publicRegistrationEnabled: true,
    },
    update: {},
  });
  const def = await prisma.tenant.upsert({
    where: { slug: 'default' },
    create: { slug: 'default', name: 'Default', concurrentLimit: 50 },
    update: {},
  });

  // Seed Root Admin (env-configurable)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@meetropolis.local';
  const adminPass = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminName = process.env.SEED_ADMIN_NAME || 'Root Admin';

  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const hash = await bcrypt.hash(adminPass, 10);
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: adminEmail, name: adminName, passwordHash: hash, emailVerifiedAt: new Date() },
    });

    console.log('Seeded admin user:', adminEmail);
  } else {
    // Update password hash (so seed always sets the expected password)
    admin = await prisma.user.update({ where: { email: adminEmail }, data: { passwordHash: hash } });

    console.log('Admin user exists, password updated:', adminEmail);
  }

  // Ensure memberships
  if (admin) {
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: internal.id, userId: admin.id } } as any,
      update: { role: 'owner' as any },
      create: { tenantId: internal.id, userId: admin.id, role: 'owner' as any },
    });
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: def.id, userId: admin.id } } as any,
      update: { role: 'owner' as any },
      create: { tenantId: def.id, userId: admin.id, role: 'owner' as any },
    });
  }

  // Seed default avatar pack
  const defaultAvatarStates = {
    idle: { directions: ['down', 'left', 'right', 'up'], frameCount: 1, frameRate: 1, row: 0 },
    walk: { directions: ['down', 'left', 'right', 'up'], frameCount: 4, frameRate: 8, row: 4 },
  };
  const defaultAvatarKeys: Array<{ key: string; displayName: string }> = [
    { key: 'business_man', displayName: 'Business Man' },
    { key: 'business_woman', displayName: 'Business Woman' },
    { key: 'casual_woman', displayName: 'Casual Woman' },
    { key: 'dev_hoodie', displayName: 'Developer' },
    { key: 'manager_woman', displayName: 'Manager' },
    { key: 'suit_man', displayName: 'Suit Man' },
  ];
  const defaultAvatars = defaultAvatarKeys.map((entry) => ({
    id: entry.key,
    key: entry.key,
    displayName: entry.displayName,
    type: 'full',
    spriteUrl: `/assets/sprites/${entry.key}.png`,
    frameWidth: 32,
    frameHeight: 32,
    states: defaultAvatarStates,
  }));
  // The default pack is a SHIPPED LIBRARY, not editorial content: the seed owns
  // its contents and must refresh them on every run. The previous `update`
  // branch only bumped `version`, so any database created before the current
  // character set stayed on its first-ever `avatars` payload forever — the row
  // existed, so `create` never ran again, and nothing else writes it.
  //
  // `tenantId` is deliberately absent from BOTH branches. In `create` the
  // column default (NULL = platform catalog) applies. In `update`, naming it at
  // all — even as `tenantId: null` — would reset an ownership assignment made
  // by an operator on the next deploy. The seed only ever touches
  // `uuid = 'default-characters'`; tenant-owned packs are none of its business.
  await prisma.avatarPack.upsert({
    where: { uuid: 'default-characters' },
    create: {
      uuid: 'default-characters',
      name: 'Default Characters',
      description: 'Built-in character set (procedurally generated, see tools/sprite-generator)',
      author: 'Meetropolis',
      version: '2.0.0',
      type: 'full',
      avatars: defaultAvatars,
    },
    update: {
      name: 'Default Characters',
      description: 'Built-in character set (procedurally generated, see tools/sprite-generator)',
      author: 'Meetropolis',
      version: '2.0.0',
      type: 'full',
      avatars: defaultAvatars,
    },
  });

  // ---------------------------------------------------------------------
  // Built-in pixel-agents furniture AssetPack.
  //
  // The pack collects every PNG under apps/web/public/assets/furniture/
  // as an `objects` entry on a single AssetPack. The map importer (next
  // step) references this pack uuid for every placed object.
  // ---------------------------------------------------------------------
  type FurnitureItem = {
    id: string;
    key: string;
    dataURL: string;
    width: number;
    height: number;
    collide: boolean;
    rotationAllowed: boolean;
    scaleFactor: number;
    // Depth-layering defaults (Strang B/C), so editor-placed furniture matches
    // the generated office template.
    collisionBaseHeight: number;
    renderLayer: 'floor' | 'sorted' | 'overhead';
  };

  const furnitureItems: FurnitureItem[] = [];
  if (fs.existsSync(furnitureDir)) {
    const groups = fs.readdirSync(furnitureDir).sort();
    for (const groupName of groups) {
      const groupDir = path.join(furnitureDir, groupName);
      const manifestPath = path.join(groupDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      type ManifestNode = {
        id?: string;
        type?: string;
        file?: string;
        width?: number;
        height?: number;
        footprintW?: number;
        footprintH?: number;
        category?: string;
        collisionBaseHeight?: number;
        members?: ManifestNode[];
      };
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestNode;
      const addAsset = (node: ManifestNode) => {
        const fileName = node.file ?? `${node.id ?? manifest.id ?? groupName}.png`;
        const id = node.id ?? manifest.id ?? groupName;
        const w = node.width ?? manifest.width ?? 16;
        const h = node.height ?? manifest.height ?? 16;
        const category = manifest.category ?? 'misc';
        // Collide policy mirrors the map generator's collides_for (B-DP7): wall
        // art, misc surface items (BIN/COFFEE) and desktop electronics (PC) do
        // not block; floor furniture and potted plants do.
        const collides =
          category !== 'wall' &&
          category !== 'misc' &&
          category !== 'electronics' &&
          !id.includes('PAINTING') &&
          !id.includes('CLOCK');
        const collisionBaseHeight = node.collisionBaseHeight ?? manifest.collisionBaseHeight ?? 0;
        const renderLayer: 'floor' | 'sorted' | 'overhead' = category === 'wall' ? 'overhead' : 'sorted';
        furnitureItems.push({
          id,
          key: id,
          dataURL: `/assets/furniture/${groupName}/${fileName}`,
          width: w,
          height: h,
          collide: collides,
          rotationAllowed: false,
          scaleFactor: 1,
          collisionBaseHeight,
          renderLayer,
        });
      };
      const walk = (node: ManifestNode) => {
        if (node.type === 'asset' || !node.members) {
          addAsset(node);
          return;
        }
        for (const child of node.members ?? []) walk(child);
      };
      walk(manifest);
    }
  }

  if (furnitureItems.length === 0) {
    console.error(
      `SEED: no furniture assets found under ${furnitureDir}. Keeping the existing AssetPack contents. ` +
        'Check that the image build copies apps/web/public into the seed stage.',
    );
  }
  await prisma.assetPack.upsert({
    where: { uuid: 'pixel-agents-furniture' },
    create: {
      uuid: 'pixel-agents-furniture',
      name: 'Pixel Agents Furniture',
      description:
        'Built-in office furniture set snapshotted from pablodelucca/pixel-agents (MIT). See THIRD_PARTY_LICENSES/MIT-pixel-agents.txt and tools/map-builder/ for the build pipeline.',
      author: 'pablodelucca (snapshotted by Meetropolis)',
      version: '1.0.0',
      terrain: [],
      structures: [],
      objects: furnitureItems,
      autotiles: [],
    },
    update: {
      version: '1.0.0',
      // Refresh the shipped object list — but never overwrite a populated pack
      // with an empty one. If the asset directory is absent (a build stage that
      // does not copy apps/web/public), an unconditional write would wipe every
      // furniture entry on the very next deploy and orphan all placed objects.
      ...(furnitureItems.length > 0 ? { objects: furnitureItems } : {}),
    },
  });

  // ---------------------------------------------------------------------
  // Starter map for the `default` tenant. Without a Map row the frontend's
  // initial /maps/<id>/{editor-state,tilesets,objects,state-v2} calls all 404,
  // because the tenant carries `defaultMapName='office'`.
  //
  // ONLY WHEN MISSING. This used to be an unconditional `importTmjIntoMap`
  // call, which re-imported the template over the tenant's live map on every
  // single deploy and destroyed whatever had been built in the editor since.
  // Runs after the AssetPack upsert because the importer resolves the object
  // pack by uuid.
  // ---------------------------------------------------------------------
  const defaultMapName = def.defaultMapName || 'office';
  let defaultMap = await prisma.map.findUnique({
    where: { tenantId_name: { tenantId: def.id, name: defaultMapName } },
  });
  if (!defaultMap) {
    // Empty fallback allowed: `default` is a live workspace whose map an
    // operator can rebuild in the editor at any time.
    defaultMap = await createStarterMap(def.id, defaultMapName, true);

    console.log('Seeded default map:', defaultMapName, 'for tenant', def.slug);
  }
  await ensureLobbyRoom(def.id, defaultMap.id);

  // ---------------------------------------------------------------------
  // Template tenant: the blueprint every new tenant's first map is copied
  // from (see copyTemplateMapsForSignup). It holds exactly ONE map, named
  // after its own `defaultMapName`.
  //
  // The slug comes from `resolveTemplateTenantSlug`, the SAME resolver the
  // signup path uses, so seed and signup can never drift apart — not even on
  // an installation that leaves TEMPLATE_TENANT_SLUG unset. While an
  // installation still points TEMPLATE_TENANT_SLUG at an existing tenant, this
  // whole block is a no-op for that tenant: the upsert does not update, and
  // the map already exists, so nothing is imported.
  // ---------------------------------------------------------------------
  const templateSlug = resolveTemplateTenantSlug();
  const template = await prisma.tenant.upsert({
    where: { slug: templateSlug },
    // concurrentLimit 0: the template holds no paying seats. The `freeSeats`
    // default still lets an admin enter it to edit the blueprint map.
    create: { slug: templateSlug, name: 'Template', concurrentLimit: 0, defaultMapName: 'office' },
    // Never rewrite an existing tenant — it may be a live, populated one.
    update: {},
  });
  const templateMapName = template.defaultMapName || 'office';
  let templateMap = await prisma.map.findUnique({
    where: { tenantId_name: { tenantId: template.id, name: templateMapName } },
  });
  if (!templateMap) {
    // NO empty fallback: see createStarterMap. A blank blueprint here is
    // irreversible and would reach every future customer.
    templateMap = await createStarterMap(template.id, templateMapName, false);

    console.log('Seeded template map:', templateMapName, 'for tenant', template.slug);
  }
  // Unconditional, exactly like the `default` branch above. copyMapToTenant
  // clones rooms, so a blueprint without a lobby hands every new customer a map
  // with no room to enter. Inside the `if` this was unreachable whenever the
  // map had been created out-of-band (the runbook's manual-import fallback):
  // the map existed, the block was skipped, and no later seed run could ever
  // heal a missed lobby. `ensureLobbyRoom` is idempotent.
  await ensureLobbyRoom(template.id, templateMap.id);
  // Root-admin membership so a fresh installation can edit the blueprint.
  // Customer-specific memberships are a deployment concern, not a seed concern.
  if (admin) {
    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: template.id, userId: admin.id } } as any,
      update: {},
      create: { tenantId: template.id, userId: admin.id, role: 'owner' as any },
    });
  }

  // Create a default invite (for onboarding teammates)
  const existingInvite = await prisma.invite.findFirst({ where: { email: adminEmail, tenantId: def.id } });
  if (!existingInvite) {
    const code = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    await prisma.invite.create({
      data: { code, email: adminEmail, createdBy: admin.id, tenantId: def.id, role: 'admin' as any },
    });

    console.log('Seeded invite for admin email (can be shared to teammates):', code);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
