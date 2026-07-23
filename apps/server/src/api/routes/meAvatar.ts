import type express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { canonicalConfig, validateConfig, type AvatarConfig, type SpriteCatalog } from '@meetropolis/shared';
import { logger } from '../../logger.js';
import { avatarComposeRateLimiter, avatarResolveRateLimiter } from '../middleware/rateLimit.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';
import { customAvatarScopeWhere } from '../../services/packScope.js';
import {
  avatarEditorEnabled,
  buildCustomManifest,
  composeAvatar,
  configHashHex,
  customPreviewUrl,
  customSpriteUrl,
  deleteCustomAvatarFiles,
  loadSpriteCatalog,
  writeCustomAvatarFiles,
} from '../../services/avatarComposer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom avatars carry a generic label; the composing user's real name is
// deliberately NOT leaked through the resolve endpoint. Defence in depth on top
// of the tenant scope on `handleResolve`, not a substitute for it.
const CUSTOM_DISPLAY_NAME = 'Custom Avatar';

// Loose HTTP shape only; the authoritative rule check is the shared, catalog-
// driven validateConfig. `.strict()` rejects unknown keys.
const ConfigSchema = z
  .object({
    skin: z.string(),
    hair: z.string(),
    hair_color: z.string(),
    outfit: z.string().default('trousers'),
    top: z.string().nullish(),
    pants: z.string().nullish(),
    shoes: z.string().nullish(),
    beard: z.string().nullish(),
    beard_color: z.string().nullish(),
    glasses: z.string().nullish(),
    hat: z.string().nullish(),
    misc: z.string().nullish(),
  })
  .strict();

const ResolveSchema = z.object({ ids: z.array(z.string()).max(200) });

type RequireAuth = (req: express.Request) => { userId: string; tenantId?: string } | null;

interface CustomAvatarRow {
  uuid: string;
  tenantId: string | null;
  spriteUrl: string;
  previewUrl: string | null;
  configHash: string;
}

function catalogOrNull(): SpriteCatalog | null {
  try {
    return loadSpriteCatalog();
  } catch (err) {
    logger.error('[meAvatar] sprite catalog unavailable', { error: String(err) });
    return null;
  }
}

function toJsonConfig(config: AvatarConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) if (typeof value === 'string') out[key] = value;
  return out;
}

/**
 * The tenant a composed row may be stamped with — the WRITE half of the rule
 * `handleResolve` applies when READING, and it has to be the same rule or the
 * row is born unreadable.
 *
 * The column used to be filled from `auth.tenantId` (the JWT `tid`) with no
 * check at all, while the read path compares against `req.tenant` AND demands a
 * membership row. Those two sources can disagree: `resolveTenantForLogin`
 * (api/routes/auth.signin.ts) falls back to the user's most recent membership
 * when they are not a member of the tenant they logged in against, so a session
 * can carry `tid = X` while every later request of that user resolves to the
 * default tenant. Such a session composed a row stamped `X` that nobody — not
 * even its owner — could ever resolve: a silently broken avatar rather than an
 * error, because the client just caches the missing manifest and retries.
 *
 * The stamp is therefore only taken when all three agree: the session carries a
 * `tid`, `resolvePackScope` resolves THIS request to that same tenant, and it
 * did so on the strength of a membership row. Anything else is refused rather
 * than written — a dead row is worse than a failed save, it reports success and
 * breaks later, somewhere else.
 *
 * Note what this does NOT weaken: the stamp still comes from the JWT-verified
 * `tid`, never from the client-supplied `X-Tenant` header. A spoofed header can
 * only make the two disagree, which refuses the request; it can never plant an
 * avatar into a foreign tenant.
 *
 * The platform super-admin is the one documented exception, as everywhere else
 * in services/packScope.ts: it resolves to the unfiltered `all` scope before
 * any membership lookup, so there is no membership for the `tid` to agree with.
 *
 * Returns `null` for "nothing proven". Callers must refuse; falling back to a
 * NULL stamp is not an option — see the CustomAvatar note in
 * prisma/schema.prisma for why an unattributed row resolves for nobody.
 */
async function provenComposeTenant(
  prisma: PrismaClient,
  req: express.Request,
  auth: { userId: string; tenantId?: string },
): Promise<string | null> {
  if (!auth.tenantId) return null;
  const scope = await resolvePackScope(prisma, req);
  if (scope.kind === 'all') return auth.tenantId;
  if (scope.kind === 'tenant' && scope.tenantId === auth.tenantId) return auth.tenantId;
  return null;
}

async function handleCompose(
  prisma: PrismaClient,
  requireAuth: RequireAuth,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  if (!avatarEditorEnabled()) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const catalog = catalogOrNull();
  if (!catalog) {
    res.status(503).json({ error: 'catalog unavailable' });
    return;
  }
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.issues });
    return;
  }
  const validation = validateConfig(catalog, parsed.data);
  if (!validation.ok) {
    res.status(400).json({ error: 'invalid config', details: validation.errors });
    return;
  }

  const tenantId = await provenComposeTenant(prisma, req, auth);
  if (tenantId === null) {
    res.status(403).json({ error: 'tenant_not_proven' });
    return;
  }

  const canonical = canonicalConfig(catalog, parsed.data);
  const configHash = configHashHex(catalog, canonical);
  const existing = await prisma.customAvatar.findUnique({ where: { userId: auth.userId } });

  const built = await persistCustomAvatar(prisma, packsDir, catalog, {
    userId: auth.userId,
    tenantId,
    canonical,
    configHash,
    existing,
  });

  await prisma.user.update({ where: { id: auth.userId }, data: { avatarId: built.avatarId } });
  res.json({ avatarId: built.avatarId, manifest: built.manifest });
}

async function persistCustomAvatar(
  prisma: PrismaClient,
  packsDir: string,
  catalog: SpriteCatalog,
  args: {
    userId: string;
    tenantId: string;
    canonical: AvatarConfig;
    configHash: string;
    existing: CustomAvatarRow | null;
  },
) {
  const { userId, tenantId, canonical, configHash, existing } = args;
  const manifestFor = (row: CustomAvatarRow) =>
    buildCustomManifest(row.uuid, row.spriteUrl, row.previewUrl, catalog.format, CUSTOM_DISPLAY_NAME);

  // Unchanged appearance: keep the existing uuid/files (idempotent, no
  // re-encode). The ATTRIBUTION is still refreshed, because a row written
  // before the tenant column existed carries NULL and therefore resolves for
  // nobody — without this it would stay that way no matter how often its owner
  // re-saved, since the config hash never changes. Re-saving is the documented
  // way such a row heals (services/packScope.ts), so it has to actually heal.
  if (existing && existing.configHash === configHash) {
    if (existing.tenantId !== tenantId) {
      await prisma.customAvatar.update({ where: { userId }, data: { tenantId } });
    }
    return { avatarId: `custom:${existing.uuid}`, manifest: manifestFor(existing) };
  }

  const uuid = crypto.randomUUID();
  const { sheetPng, previewPng } = composeAvatar(catalog, canonical);
  await writeCustomAvatarFiles(packsDir, uuid, sheetPng, previewPng);

  const spriteUrl = customSpriteUrl(uuid);
  const previewUrl = customPreviewUrl(uuid);
  const configJson = toJsonConfig(canonical) as Prisma.InputJsonValue;
  const data = { uuid, tenantId, config: configJson, spriteUrl, previewUrl, configHash };
  const row = await prisma.customAvatar.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  // A new uuid means the previous sprite/preview are now orphaned — remove them.
  if (existing && existing.uuid !== uuid) await deleteCustomAvatarFiles(packsDir, existing.uuid);
  return { avatarId: `custom:${row.uuid}`, manifest: manifestFor(row) };
}

/**
 * Resolve `custom:<uuid>` avatar ids to render manifests — the endpoint a peer
 * calls so it can DRAW the figure of somebody standing next to it.
 *
 * TENANT-SCOPED, and that scope is the whole point. This handler used to run
 * `findMany({ where: { uuid: { in: uuids } } })` behind a bare "is anybody
 * logged in" check, so any authenticated user of any tenant could POST a uuid
 * and receive a foreign tenant's manifest. Reproduced live on production before
 * this fix. The legitimate audience is precisely the people who share a world
 * with the owner, and those are members of the owner's tenant — so the rule is:
 * a caller resolves only custom avatars of a tenant it has PROVEN.
 *
 * The proof comes from `resolvePackScope`, the same fail-closed resolver behind
 * the pack routes: identity from a session or an API token, then a membership
 * row in the RESOLVED tenant. Tenant resolution is not authorisation —
 * tenancy.ts lets a client-supplied `X-Tenant` header win over the session JWT
 * — so a spoofed header only names a tenant, and the missing membership row
 * collapses the request to the catalog scope. For custom avatars the catalog
 * scope resolves NOTHING (`customAvatarScopeWhere` returns null, see
 * services/packScope.ts), which is also where every error path lands.
 *
 * The array is filtered, not rejected: a mixed batch returns the in-scope
 * entries and silently drops the rest. That keeps a legitimate batched render
 * working while a probe learns nothing about the ids it may not have — a
 * missing manifest is indistinguishable from a non-existent uuid.
 */
async function handleResolve(
  prisma: PrismaClient,
  requireAuth: RequireAuth,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  if (!avatarEditorEnabled()) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (!requireAuth(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const catalog = catalogOrNull();
  if (!catalog) {
    res.status(503).json({ error: 'catalog unavailable' });
    return;
  }
  const parsed = ResolveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: parsed.error.issues });
    return;
  }

  const uuids = parsed.data.ids
    .map((id) => (id.startsWith('custom:') ? id.slice('custom:'.length) : null))
    .filter((v): v is string => v !== null);

  const scopeWhere = customAvatarScopeWhere(await resolvePackScope(prisma, req));
  const manifests: Record<string, ReturnType<typeof buildCustomManifest>> = {};
  if (scopeWhere !== null && uuids.length > 0) {
    const rows = await prisma.customAvatar.findMany({ where: { uuid: { in: uuids }, ...scopeWhere } });
    for (const row of rows) {
      manifests[`custom:${row.uuid}`] = buildCustomManifest(
        row.uuid,
        row.spriteUrl,
        row.previewUrl,
        catalog.format,
        CUSTOM_DISPLAY_NAME,
      );
    }
  }
  res.json({ manifests });
}

async function handleGetMine(
  prisma: PrismaClient,
  requireAuth: RequireAuth,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  if (!avatarEditorEnabled()) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const row = await prisma.customAvatar.findUnique({ where: { userId: auth.userId } });
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const catalog = catalogOrNull();
  const manifest = catalog
    ? buildCustomManifest(row.uuid, row.spriteUrl, row.previewUrl, catalog.format, CUSTOM_DISPLAY_NAME)
    : null;
  res.json({ avatarId: `custom:${row.uuid}`, config: row.config, manifest });
}

export function registerMeAvatarRoutes(app: express.Application, prisma: PrismaClient, requireAuth: RequireAuth): void {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');

  app.post('/me/avatar/compose', avatarComposeRateLimiter, (req, res) =>
    handleCompose(prisma, requireAuth, packsDir, req, res),
  );
  app.post('/avatars/resolve', avatarResolveRateLimiter, (req, res) => handleResolve(prisma, requireAuth, req, res));
  app.get('/me/avatar/custom', (req, res) => handleGetMine(prisma, requireAuth, req, res));
}
