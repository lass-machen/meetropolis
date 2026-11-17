import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, expect, it } from 'vitest';

// Apply the real migration history before the invite-code hash migration in
// a private schema, seed an invite with a plaintext code, then apply that
// migration and check that the old raw code still resolves through its hash.
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('The assigned test database is missing.');
const url = new URL(rawUrl);
if (url.hostname !== '127.0.0.1' || url.port !== '35440') throw new Error('Migration tests require 127.0.0.1:35440.');
const schema = `invite_code_hash_migration_${crypto.randomBytes(10).toString('hex')}`;
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

it('rewrites a plaintext invite code to its hash so the sent link still redeems', async () => {
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
  const target = '20261117090100_hash_invite_codes';
  if (!migrations.includes(target)) throw new Error('Required invite-code hash migration is missing.');
  for (const migration of migrations.filter((name) => name < target)) {
    const sql = await readFile(path.join(directory, migration, 'migration.sql'), 'utf8');
    // The bootstrap names public explicitly; all table and type statements
    // remain unchanged and run in the private schema through search_path.
    await client.query(sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ''));
  }

  const tenant = `c${crypto.randomBytes(12).toString('hex')}`;
  const invite = `c${crypto.randomBytes(12).toString('hex')}`;
  const rawCode = crypto.randomBytes(12).toString('hex');
  const expectedHash = crypto.createHash('sha256').update(rawCode).digest('hex');
  await client.query('INSERT INTO "Tenant" ("id","slug","name","updatedAt") VALUES ($1,$1,$1,now())', [tenant]);
  await client.query(
    'INSERT INTO "Invite" ("id","code","tenantId","email","createdAt","expiresAt") VALUES ($1,$2,$3,$4,now(),now() + interval \'7 days\')',
    [invite, rawCode, tenant, `invitee-${crypto.randomBytes(8).toString('hex')}@example.test`],
  );

  await client.query(await readFile(path.join(directory, target, 'migration.sql'), 'utf8'));

  const stored = await client.query('SELECT "code" FROM "Invite" WHERE "id"=$1', [invite]);
  expect(stored.rows).toEqual([{ code: expectedHash }]);
  expect(stored.rows[0].code).not.toBe(rawCode);
  // Redemption hashes the presented raw code before the lookup, so the link
  // that was sent before the migration still finds its invite row.
  const redeemed = await client.query('SELECT "id" FROM "Invite" WHERE "code"=$1 AND "usedAt" IS NULL', [expectedHash]);
  expect(redeemed.rows).toEqual([{ id: invite }]);
  const byRaw = await client.query('SELECT "id" FROM "Invite" WHERE "code"=$1', [rawCode]);
  expect(byRaw.rows).toEqual([]);
}, 120_000);
