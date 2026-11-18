import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, expect, it } from 'vitest';
import { DISPOSABLE_TEST_DATABASE_HINT, isDisposableTestDatabase } from '../../../test/fixtures/testDatabaseGuard.js';

// Apply the real migration history before the open-invite index migration in
// a private schema, seed duplicate open invites, then apply that migration.
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('The assigned test database is missing.');
const url = new URL(rawUrl);
if (!isDisposableTestDatabase(url)) throw new Error(`Migration tests require ${DISPOSABLE_TEST_DATABASE_HINT}.`);
const schema = `invite_open_index_migration_${crypto.randomBytes(10).toString('hex')}`;
const client = new Client({ connectionString: rawUrl });
let connected = false;
let created = false;
afterAll(async () => {
  try {
    if (created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    if (connected) await client.end();
  }
});

it('keeps only the newest open invite per tenant and email and creates the partial unique index', async () => {
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
  const target = '20261117090000_unique_open_invite';
  if (!migrations.includes(target)) throw new Error('Required open-invite migration is missing.');
  for (const migration of migrations.filter((name) => name < target)) {
    const sql = await readFile(path.join(directory, migration, 'migration.sql'), 'utf8');
    // The bootstrap names public explicitly; all table and type statements
    // remain unchanged and run in the private schema through search_path.
    await client.query(sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
  }

  const tenant = `c${crypto.randomBytes(12).toString('hex')}`;
  const email = `dup-${crypto.randomBytes(8).toString('hex')}@example.test`;
  const otherEmail = `other-${crypto.randomBytes(8).toString('hex')}@example.test`;
  const olderOpen = `c${crypto.randomBytes(12).toString('hex')}`;
  const newestOpen = `c${crypto.randomBytes(12).toString('hex')}`;
  const used = `c${crypto.randomBytes(12).toString('hex')}`;
  const otherOpen = `c${crypto.randomBytes(12).toString('hex')}`;
  await client.query('INSERT INTO "Tenant" ("id","slug","name","updatedAt") VALUES ($1,$1,$1,now())', [tenant]);
  await client.query(
    `INSERT INTO "Invite" ("id","code","tenantId","email","createdAt","usedAt") VALUES
      ($1,$1,$5,$6,'2026-01-01T00:00:00.000Z',NULL),
      ($2,$2,$5,$6,'2026-01-03T00:00:00.000Z',NULL),
      ($3,$3,$5,$6,'2026-01-04T00:00:00.000Z','2026-01-05T00:00:00.000Z'),
      ($4,$4,$5,$7,'2026-01-02T00:00:00.000Z',NULL)`,
    [olderOpen, newestOpen, used, otherOpen, tenant, email, otherEmail],
  );

  await client.query(await readFile(path.join(directory, target, 'migration.sql'), 'utf8'));

  const remaining = await client.query('SELECT "id" FROM "Invite" ORDER BY "id"');
  expect(remaining.rows.map((row) => row.id).sort()).toEqual([newestOpen, otherOpen, used].sort());
  const openForEmail = await client.query(
    'SELECT "id" FROM "Invite" WHERE "tenantId"=$1 AND "email"=$2 AND "usedAt" IS NULL',
    [tenant, email],
  );
  expect(openForEmail.rows).toEqual([{ id: newestOpen }]);
  const usedRow = await client.query('SELECT "usedAt" IS NOT NULL AS used FROM "Invite" WHERE "id"=$1', [used]);
  expect(usedRow.rows).toEqual([{ used: true }]);
  const index = await client.query('SELECT "indexname" FROM pg_indexes WHERE "schemaname"=$1 AND "indexname"=$2', [
    schema,
    'Invite_open_tenantId_email_key',
  ]);
  expect(index.rows).toEqual([{ indexname: 'Invite_open_tenantId_email_key' }]);
}, 120_000);
