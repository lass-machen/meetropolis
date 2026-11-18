import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import type { Role, Tenant } from '../../src/generated/prisma/index.js';
import { createPrismaClient } from '../../src/db.js';
import { resolveTenantBySlug } from '../../src/tenancy.js';
import { createTenantAccessMiddleware } from '../../src/api/middleware/tenantAccess.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../../src/api/utils/sessionAuth.js';
import { invalidateSessionsForUser } from '../../src/api/utils/sessionCache.js';
import { getApiTokenPepper, getJwtSecret } from '../../src/api/utils/authHelpers.js';

export interface TestCaller {
  id: string;
  session: string;
  sessionId: string;
  apiToken: string;
}

/** Real isolated database fixtures using the production authentication and resolver. */
export function createHttpFixture() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('This test requires the assigned isolated DATABASE_URL');
  const parsed = new URL(databaseUrl);
  // Accept only a loopback database that is known to be disposable: the CI service on 35440,
  // or the database the test stack assigned to its slot (MT_PORT_DB, slot ports 42000-42399).
  const assignedPort = process.env.MT_PORT_DB ?? '';
  const port = Number(parsed.port);
  const isCiDatabase = parsed.port === '35440';
  const isSlotDatabase =
    assignedPort !== '' && parsed.port === assignedPort && Number.isInteger(port) && port >= 42000 && port <= 42399;
  if (parsed.hostname !== '127.0.0.1' || !(isCiDatabase || isSlotDatabase)) {
    throw new Error('This test may only use the local test database on port 35440 or its test stack slot (MT_PORT_DB)');
  }
  const prisma = createPrismaClient();
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const userEmails: string[] = [];

  async function tenant() {
    const slug = `fixture-account-${crypto.randomUUID()}`;
    const value = await prisma.tenant.create({ data: { slug, name: slug } });
    tenantIds.push(value.id);
    const map = await prisma.map.create({
      data: { tenantId: value.id, name: 'office', meta: {}, width: 4, height: 4, tileWidth: 32, tileHeight: 32 },
    });
    const room = await prisma.room.create({ data: { tenantId: value.id, mapId: map.id, name: 'lobby' } });
    return { tenant: value, map, room };
  }

  async function session(userId: string, tenantId: string) {
    const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
      expiresIn: '1h',
    });
    const row = await prisma.session.create({
      data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { token, id: row.id };
  }

  async function caller(tenantValue: Tenant, role: Role = 'member', password?: string): Promise<TestCaller> {
    const user = await prisma.user.create({
      data: {
        email: `fixture-account-${crypto.randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        passwordHash: password ? await bcrypt.hash(password, 4) : undefined,
      },
    });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantValue.id, role } });
    const auth = await session(user.id, tenantValue.id);
    const apiToken = `mt_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto
      .createHash('sha256')
      .update(getApiTokenPepper() + apiToken)
      .digest('hex');
    await prisma.apiToken.create({ data: { userId: user.id, hash, name: 'http-fixture-caller' } });
    return { id: user.id, session: auth.token, sessionId: auth.id, apiToken };
  }

  function app() {
    const value = express();
    value.use(cookieParser());
    value.use(express.json());
    value.use((req, _res, next) => {
      void resolveTenantBySlug(prisma, req)
        .then((resolved) => {
          req.tenant = resolved ?? undefined;
          req.tenantId = resolved?.id;
          next();
        })
        .catch((error: unknown) => next(error));
    });
    value.use(createSessionAuthMiddleware(prisma));
    value.use(createTenantAccessMiddleware(prisma));
    return value;
  }

  async function close() {
    const created = await prisma.user.findMany({ where: { email: { in: userEmails } }, select: { id: true } });
    for (const user of created) if (!userIds.includes(user.id)) userIds.push(user.id);
    for (const id of userIds) invalidateSessionsForUser(id);
    try {
      const maps = await prisma.map.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true } });
      const mapIds = maps.map((map) => map.id);
      await prisma.mapChunk.deleteMany({ where: { layer: { mapId: { in: mapIds } } } });
      await prisma.mapLayer.deleteMany({ where: { mapId: { in: mapIds } } });
      await prisma.mapTileset.deleteMany({ where: { mapId: { in: mapIds } } });
      await prisma.mapAutotile.deleteMany({ where: { mapId: { in: mapIds } } });
      await prisma.mapObject.deleteMany({ where: { mapId: { in: mapIds } } });
      await prisma.zone.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.npcMediaFile.deleteMany({ where: { npc: { tenantId: { in: tenantIds } } } });
      await prisma.npc.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.map.deleteMany({ where: { id: { in: mapIds } } });
      await prisma.invite.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.emailVerification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordReset.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }

  return { prisma, tenant, caller, session, app, close, tenantIds, userIds, userEmails };
}
