import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { getJwtSecret } from './authHelpers.js';
import { createSessionAuthMiddleware, hashSessionToken } from './sessionAuth.js';
import { createTenantAccessMiddleware } from '../middleware/tenantAccess.js';
import { resolveTenantBySlug } from '../../tenancy.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/index.js';
import { afterAll, expect, it } from 'vitest';
import { hasTenantAccess } from './tenantMembership.js';
import { DISPOSABLE_TEST_DATABASE_HINT, isDisposableTestDatabase } from '../../../test/fixtures/testDatabaseGuard.js';

// Apply the complete real migration history in a private schema.
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('The assigned test database is missing.');
const url = new URL(rawUrl);
if (!isDisposableTestDatabase(url)) throw new Error(`Migration tests require ${DISPOSABLE_TEST_DATABASE_HINT}.`);
const schema = `email_proof_migration_fixture_${crypto.randomBytes(10).toString('hex')}`;
const client = new Client({ connectionString: rawUrl });
let prisma: PrismaClient | undefined;
let connected = false;
let created = false;
afterAll(async () => {
  await prisma?.$disconnect();
  try {
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    if (connected) await client.end();
  }
});

it('marks only proven unverified invitation memberships and preserves identifiers and roles during migration', async () => {
  await client.connect();
  connected = true;
  await client.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await client.query(`SET search_path TO "${schema}"`);
  const directory = path.resolve('prisma/migrations');
  const migrations = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const first = '20261109080000_add_email_verification_intents';
  const second = '20261109080001_gate_unverified_invite_memberships';
  if (!migrations.includes(first) || !migrations.includes(second))
    throw new Error('Required email-proof migrations are missing.');
  for (const migration of migrations.filter((name) => name < first)) {
    const sql = await readFile(path.join(directory, migration, 'migration.sql'), 'utf8');
    // The bootstrap names public explicitly; all table and type statements
    // remain unchanged and run in the private schema through search_path.
    await client.query(sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
  }
  const ids = Array.from({ length: 12 }, () => `c${crypto.randomBytes(12).toString('hex')}`);
  const [
    tenant,
    other,
    unverified,
    verified,
    independent,
    memberA,
    memberB,
    memberC,
    memberOther,
    inviteA,
    inviteB,
    oldProof,
  ] = ids;
  await client.query('INSERT INTO "Tenant" ("id","slug","name","updatedAt") VALUES ($1,$1,$1,now()),($2,$2,$2,now())', [
    tenant,
    other,
  ]);
  await client.query(
    `INSERT INTO "User" ("id","email","emailVerifiedAt","updatedAt") VALUES ($1,$1||'@example.test',NULL,now()),($2,$2||'@example.test',now(),now()),($3,$3||'@example.test',NULL,now())`,
    [unverified, verified, independent],
  );
  await client.query(
    `INSERT INTO "Membership" ("id","tenantId","userId","role","updatedAt") VALUES
    ($1,$5,$7,'admin',now()),($2,$5,$8,'owner',now()),($3,$5,$9,'member',now()),($4,$6,$7,'member',now())`,
    [memberA, memberB, memberC, memberOther, tenant, other, unverified, verified, independent],
  );
  await client.query(
    `INSERT INTO "Invite" ("id","code","tenantId","email","usedAt","usedById") VALUES
    ($1,$6,$3,$4||'@example.test',now(),$4),($2,$7,$3,$5||'@example.test',now(),$5)`,
    [
      inviteA,
      inviteB,
      tenant,
      unverified,
      verified,
      crypto.randomBytes(12).toString('hex'),
      crypto.randomBytes(12).toString('hex'),
    ],
  );
  await client.query(
    'INSERT INTO "EmailVerification" ("id","token","userId","email","expiresAt") VALUES ($1,$1,$2,$2||\'@example.test\',now()+interval \'1 day\')',
    [oldProof, unverified],
  );
  await client.query(await readFile(path.join(directory, first, 'migration.sql'), 'utf8'));
  await client.query(await readFile(path.join(directory, second, 'migration.sql'), 'utf8'));
  const members = await client.query(
    'SELECT "id","role","inviteVerificationRequired" AS blocked FROM "Membership" ORDER BY "id"',
  );
  expect(members.rows).toHaveLength(4);
  expect(members.rows.find((row) => row.id === memberA)).toEqual({ id: memberA, role: 'admin', blocked: true });
  expect(members.rows.find((row) => row.id === memberB)).toEqual({ id: memberB, role: 'owner', blocked: false });
  expect(members.rows.filter((row) => row.id !== memberA).every((row) => row.blocked === false)).toBe(true);
  const expired = await client.query(
    'SELECT "expiresAt"<=now() AS expired, "readyAt" IS NULL AS unready FROM "EmailVerification" WHERE "id"=$1',
    [oldProof],
  );
  expect(expired.rows[0]).toEqual({ expired: true, unready: true });
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: rawUrl, options: `-c search_path=${schema}` }, { schema }),
  });
  expect(await hasTenantAccess(prisma, unverified, tenant)).toBe(false);
  expect(await hasTenantAccess(prisma, unverified, other)).toBe(true);
  expect(await hasTenantAccess(prisma, verified, tenant)).toBe(true);
  expect(await hasTenantAccess(prisma, independent, tenant)).toBe(true);
  const migrated = prisma;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    void resolveTenantBySlug(migrated, req)
      .then((tenant) => {
        req.tenant = tenant ?? undefined;
        req.tenantId = tenant?.id;
        next();
      })
      .catch(next);
  });
  app.use(createSessionAuthMiddleware(migrated));
  app.use(createTenantAccessMiddleware(migrated));
  registerAuthRoutes(app, migrated);
  const rawSession = jwt.sign({ sub: unverified, tid: tenant, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await migrated.session.create({
    data: { userId: unverified, tokenHash: hashSessionToken(rawSession), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const blockedHttp = await request(app)
    .get('/auth/me')
    .set('X-Tenant', tenant)
    .set('Authorization', `Bearer ${rawSession}`);
  expect(blockedHttp.status).toBe(409);
  expect(blockedHttp.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  // Cascading removes only the associated intent and does not prevent revocation.
  await prisma.emailVerification.create({
    data: {
      token: crypto.randomBytes(32).toString('hex'),
      userId: unverified,
      email: `${unverified}@example.test`,
      purpose: 'invite',
      inviteId: inviteA,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.invite.delete({ where: { id: inviteA } });
  expect(await prisma.emailVerification.count({ where: { inviteId: inviteA } })).toBe(0);
}, 120_000);
