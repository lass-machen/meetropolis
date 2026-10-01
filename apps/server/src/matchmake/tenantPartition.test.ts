/**
 * Partition-key validation: unit tests for the rule itself, plus tests against
 * a real Colyseus server (see testUtils/matchmakeHarness.ts) proving that a
 * refused key builds no room and no PrismaClient.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import { ServerError } from 'colyseus';
import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  rawPost,
  startMatchmakeServer,
  stopMatchmakeServer,
  worldRooms,
  type MatchmakeTestServer,
} from '../testUtils/matchmakeHarness.js';
import { TENANT_SLUG_PATTERN, assertValidPartitionOptions, isValidTenantSlug } from './tenantPartition.js';

describe('isValidTenantSlug', () => {
  it.each(['default', 'acme', 'acme-corp', 'team_42', 'a', '0', '-', '_', 'a'.repeat(64)])('accepts %s', (slug) => {
    expect(isValidTenantSlug(slug)).toBe(true);
  });

  it.each([
    '',
    'Acme',
    'acme corp',
    'acme.corp',
    'acme/x',
    '../etc',
    'acüme',
    'acme\n',
    ' acme',
    'a'.repeat(65),
    'a'.repeat(900 * 1024),
  ])('rejects %j', (slug) => {
    expect(isValidTenantSlug(slug)).toBe(false);
  });

  it.each([undefined, null, 7, true, {}, [], ['acme']])('rejects the non-string %j', (value) => {
    expect(isValidTenantSlug(value)).toBe(false);
  });

  it('covers every slug the project hands out today', () => {
    // Enterprise public sign-up: /^[a-z0-9-]+$/ with 2..64 characters.
    expect('abc-123').toMatch(TENANT_SLUG_PATTERN);
    // OSS sanitizeSlug alphabet (X-Tenant / ?tenant=): [a-z0-9_-].
    expect('a_b-c').toMatch(TENANT_SLUG_PATTERN);
    // Seeded and fallback tenants.
    for (const slug of ['default', 'internal', 'template']) expect(slug).toMatch(TENANT_SLUG_PATTERN);
  });
});

describe('assertValidPartitionOptions', () => {
  it('accepts no options, a missing tenant, an empty tenant and a valid slug', () => {
    expect(() => assertValidPartitionOptions(undefined)).not.toThrow();
    expect(() => assertValidPartitionOptions({})).not.toThrow();
    expect(() => assertValidPartitionOptions({ identity: 'u1', name: 'Ada' })).not.toThrow();
    expect(() => assertValidPartitionOptions({ tenant: '' })).not.toThrow();
    expect(() => assertValidPartitionOptions({ tenant: 'acme' })).not.toThrow();
  });

  it('refuses a malformed tenant as a 400 ServerError', () => {
    try {
      assertValidPartitionOptions({ tenant: 'Not A Slug' });
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ServerError);
      expect(error).toMatchObject({ code: 400, message: 'invalid_tenant' });
    }
  });

  it.each([null, [], 'acme', 7, true])('refuses options that are not an object: %j', (options) => {
    expect(() => assertValidPartitionOptions(options)).toThrow(/invalid_options/);
  });
});

describe('partition key against a real Colyseus server', () => {
  let server: MatchmakeTestServer;

  beforeAll(async () => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    server = await startMatchmakeServer();
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
  });

  beforeEach(async () => {
    await disposeAllRooms();
    createPrismaClientMock.mockClear();
  });

  it.each([
    ['uppercase letters', 'Acme'],
    ['a space', 'acme corp'],
    ['a path traversal', '../etc'],
    ['a dot', 'acme.corp'],
    ['a slash', 'acme/x'],
    ['a non-ASCII letter', 'acüme'],
    ['65 characters', 'a'.repeat(65)],
    ['900 KB of characters', 'a'.repeat(900 * 1024)],
    ['an object', { $ne: 1 }],
    ['an array', ['acme']],
    ['a number', 7],
    ['null', null],
    ['a boolean', true],
  ])('refuses a tenant with %s and builds no room and no PrismaClient', async (_label, tenant) => {
    const res = await matchmake(server, JSON.stringify({ tenant }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 400, error: 'invalid_tenant' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses a bad tenant on every matchmake method, not only joinOrCreate', async () => {
    for (const method of ['create', 'join', 'joinOrCreate']) {
      const res = await matchmake(server, JSON.stringify({ tenant: 'Bad Slug' }), {
        path: `/matchmake/${method}/world`,
      });
      expect(res.status, method).toBe(400);
    }
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses an options payload that is not an object', async () => {
    const res = await matchmake(server, '[]');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_options');
    expect(await worldRooms()).toHaveLength(0);
  });

  it.each(['default', 'acme', 'acme-corp', 'team_42', 'a', 'a'.repeat(64), '0', '-'])(
    'creates a room for the valid slug %s',
    async (tenant) => {
      const res = await matchmake(server, JSON.stringify({ tenant }));
      expect(res.status).toBe(200);
      expect(res.body.roomId).toBeTruthy();
      const rooms = await worldRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0]?.metadata?.tenant).toBe(tenant);
      expect(createPrismaClientMock).toHaveBeenCalledTimes(1);
    },
  );

  it('joins the existing room of a tenant instead of creating another one', async () => {
    await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    const second = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    expect(second.status).toBe(200);
    expect(await worldRooms()).toHaveLength(1);
    expect(createPrismaClientMock).toHaveBeenCalledTimes(1);
  });

  it('keeps accepting a missing tenant and an empty tenant (single-tenant default)', async () => {
    expect((await matchmake(server, JSON.stringify({}))).status).toBe(200);
    expect((await matchmake(server, JSON.stringify({ tenant: '' }))).status).toBe(200);
  });

  it('keeps accepting a request with an empty body', async () => {
    const status = await rawPost(server, { 'content-length': '0' }, (req) => req.end());
    expect(status).toBe(200);
  });

  it('still answers an unknown room name with the Colyseus error', async () => {
    const res = await matchmake(server, JSON.stringify({}), { path: '/matchmake/joinOrCreate/nope' });
    expect(res.status).toBe(520);
  });
});
