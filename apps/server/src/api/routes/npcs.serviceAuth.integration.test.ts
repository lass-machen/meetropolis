import crypto from 'crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { getJwtSecret } from '../utils/authHelpers.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { registerNpcRoutes } from './npcs.js';

/**
 * Service-to-service auth on GET /npcs against a real PostgreSQL database.
 * The list with tenant rows is the grant signal; session listing stays tenant-scoped.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('npcs.serviceAuth.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const SECRET_KEY = 'NPC_SERVICE_SECRET';
const SECRET_HEADER = 'x-npc-secret';
const prisma = createPrismaClient();

function readKnownDefaultSecret(): string {
  const source = readFileSync(fileURLToPath(new URL('../../../../npc-service/src/config.ts', import.meta.url)), 'utf8');
  const named = source.match(/KNOWN_DEFAULT_SECRET\s*=\s*'([^']+)'/);
  if (named?.[1]) return named[1];
  const fallback = source.match(/NPC_SERVICE_SECRET[^\n]*\|\|\s*'([^']+)'/);
  if (fallback?.[1]) return fallback[1];
  throw new Error('NPC service config does not declare a documented secret placeholder');
}

function randomSecret(byteLength: number): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

function npcIds(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((row) => (row && typeof row === 'object' && 'id' in row ? [String(row.id)] : [])).sort();
}

function listsBothWithTenant(body: unknown, ids: readonly string[]): boolean {
  if (!Array.isArray(body)) return false;
  const got = new Set(npcIds(body));
  const withTenant = body.every(
    (row) =>
      row &&
      typeof row === 'object' &&
      'tenant' in row &&
      row.tenant &&
      typeof row.tenant === 'object' &&
      'slug' in row.tenant,
  );
  return ids.every((id) => got.has(id)) && withTenant;
}

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.use(async (req, _res, next) => {
    const id = req.headers['x-tenant'];
    const tenant = typeof id === 'string' ? await prisma.tenant.findUnique({ where: { id } }) : null;
    if (tenant) req.tenant = tenant;
    next();
  });
  registerNpcRoutes(app, prisma);
  return app;
}

async function getNpcsWithRepeatedSecret(
  app: express.Express,
  secret: string,
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('listening server has no port');
    }
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/npcs',
          method: 'GET',
          headers: { [SECRET_HEADER]: [secret, secret], connection: 'close' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body: unknown = raw;
            try {
              body = JSON.parse(raw) as unknown;
            } catch {
              // Keep the raw body when the response is not JSON.
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.setTimeout(5000, () => req.destroy(new Error('repeated-header request timed out')));
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

const tenantIds: string[] = [];
const userIds: string[] = [];
const npcIdList: string[] = [];
let app: express.Express;
let tenantAId: string;
let npcAId: string;
let npcBId: string;
let memberSession: string;
let previousSecret: string | undefined;

beforeAll(async () => {
  const tenantA = await prisma.tenant.create({
    data: { slug: `npc-svc-${crypto.randomUUID()}`, name: 'Service list A' },
  });
  const tenantB = await prisma.tenant.create({
    data: { slug: `npc-svc-${crypto.randomUUID()}`, name: 'Service list B' },
  });
  tenantAId = tenantA.id;
  tenantIds.push(tenantA.id, tenantB.id);

  const npcA = await prisma.npc.create({
    data: { tenantId: tenantA.id, identity: 'greeter-a', name: 'Greeter A' },
  });
  const npcB = await prisma.npc.create({
    data: { tenantId: tenantB.id, identity: 'greeter-b', name: 'Greeter B' },
  });
  npcAId = npcA.id;
  npcBId = npcB.id;
  npcIdList.push(npcA.id, npcB.id);

  const user = await prisma.user.create({ data: { email: `npc-svc-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA.id, role: 'member' } });
  memberSession = jwt.sign({ sub: user.id, tid: tenantA.id, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(memberSession), expiresAt: new Date(Date.now() + 3_600_000) },
  });

  app = makeApp();
});

beforeEach(() => {
  previousSecret = process.env[SECRET_KEY];
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = previousSecret;
});

afterAll(async () => {
  await prisma.npc.deleteMany({ where: { id: { in: npcIdList } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('GET /npcs service authentication', () => {
  it('does not grant the cross-tenant list when the configured secret is the known default', async () => {
    const configured = readKnownDefaultSecret();
    process.env[SECRET_KEY] = configured;
    const res = await request(app).get('/npcs').set(SECRET_HEADER, configured);
    expect(res.status).toBe(401);
    expect(listsBothWithTenant(res.body, [npcAId, npcBId])).toBe(false);
  });

  it('does not grant the cross-tenant list when the configured secret is 16 characters', async () => {
    const configured = randomSecret(8);
    process.env[SECRET_KEY] = configured;
    const res = await request(app).get('/npcs').set(SECRET_HEADER, configured);
    expect(res.status).toBe(401);
    expect(listsBothWithTenant(res.body, [npcAId, npcBId])).toBe(false);
  });

  it('grants the cross-tenant list when a valid secret matches the header', async () => {
    const configured = randomSecret(16);
    process.env[SECRET_KEY] = configured;
    const res = await request(app).get('/npcs').set(SECRET_HEADER, configured);
    expect(res.status).toBe(200);
    expect(listsBothWithTenant(res.body, [npcAId, npcBId])).toBe(true);
  });

  it('does not grant the cross-tenant list for a same-length wrong secret', async () => {
    const configured = randomSecret(16);
    let provided = randomSecret(16);
    while (provided === configured) provided = randomSecret(16);
    process.env[SECRET_KEY] = configured;
    const res = await request(app).get('/npcs').set(SECRET_HEADER, provided);
    expect(res.status).toBe(401);
    expect(listsBothWithTenant(res.body, [npcAId, npcBId])).toBe(false);
  });

  it('does not grant the cross-tenant list when the secret header is sent twice', async () => {
    const configured = randomSecret(16);
    process.env[SECRET_KEY] = configured;
    const res = await getNpcsWithRepeatedSecret(app, configured);
    expect(res.status).toBe(401);
    expect(listsBothWithTenant(res.body, [npcAId, npcBId])).toBe(false);
  });

  it('lists only the session tenant when no service header is sent', async () => {
    process.env[SECRET_KEY] = randomSecret(16);
    const res = await request(app)
      .get('/npcs')
      .set('Authorization', `Bearer ${memberSession}`)
      .set('x-tenant', tenantAId);
    expect(res.status).toBe(200);
    expect(npcIds(res.body)).toEqual([npcAId]);
    expect(res.body[0]).not.toHaveProperty('tenant');
  });
});
