/**
 * Partition-key validation: unit tests for the rule itself, plus tests against
 * a real Colyseus server (see testUtils/matchmakeHarness.ts) proving that a
 * refused key builds no room and no PrismaClient. The transport guard is left
 * out here on purpose: the validation has to hold on its own.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
  TENANT_SLUG_PATTERN,
  assertTenantExists,
  assertValidPartitionOptions,
  createTenantExistsLookup,
  installPartitionKeyValidation,
  isValidTenantSlug,
  resolveEmptyPartitionKey,
  type TenantExists,
} from './tenantPartition.js';
import type { PrismaClient } from '../generated/prisma/index.js';

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

  // JSON.parse, not an object literal: only the parser makes `__proto__` an own key.
  it.each(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf'])(
    'refuses the own key %s at the top level',
    (key) => {
      const options: unknown = JSON.parse(`{"${key}":{"tenant":"zz-evil-1"}}`);
      expect(() => assertValidPartitionOptions(options)).toThrow(/invalid_options/);
      expect(() => assertValidPartitionOptions(options)).toThrow(ServerError);
    },
  );

  it('refuses the key even next to harmless options and a valid tenant', () => {
    const options: unknown = JSON.parse('{"identity":"u1","tenant":"acme","__proto__":{"tenant":"zz-evil-1"}}');
    expect(() => assertValidPartitionOptions(options)).toThrow(/invalid_options/);
  });

  it('leaves such names alone below the top level, where they are plain data', () => {
    const options: unknown = JSON.parse('{"identity":{"__proto__":1,"constructor":2},"tenant":"acme"}');
    expect(() => assertValidPartitionOptions(options)).not.toThrow();
  });
});

describe('resolveEmptyPartitionKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names the default tenant for an empty tenant and leaves the other fields alone', () => {
    expect(resolveEmptyPartitionKey({ tenant: '', identity: 'u1' })).toEqual({ tenant: 'default', identity: 'u1' });
  });

  it('follows DEFAULT_TENANT_SLUG, like WorldRoom.onCreate', () => {
    vi.stubEnv('DEFAULT_TENANT_SLUG', 'main');
    expect(resolveEmptyPartitionKey({ tenant: '' })).toEqual({ tenant: 'main' });
  });

  it('does not touch the caller\u2019s object', () => {
    const options = { tenant: '' };
    resolveEmptyPartitionKey(options);
    expect(options).toEqual({ tenant: '' });
  });

  it.each([undefined, {}, { tenant: 'acme' }, { identity: 'u1' }, [], null, 'x'])(
    'passes %j through unchanged',
    (options) => {
      expect(resolveEmptyPartitionKey(options)).toBe(options);
    },
  );
});

describe('assertTenantExists', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const refusal = { code: 400, message: 'invalid_tenant' };

  it('refuses a well-formed slug no tenant has', async () => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(false);
    await expect(assertTenantExists({ tenant: 'no-such-tenant' }, lookup)).rejects.toMatchObject(refusal);
    await expect(assertTenantExists({ tenant: 'no-such-tenant' }, lookup)).rejects.toBeInstanceOf(ServerError);
    expect(lookup).toHaveBeenCalledWith('no-such-tenant');
  });

  it('accepts a slug a tenant has', async () => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    await expect(assertTenantExists({ tenant: 'acme', identity: 'u1' }, lookup)).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledExactlyOnceWith('acme');
  });

  it('does not look the default tenant up, so an OSS install without a tenant row can join', async () => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(false);
    await expect(assertTenantExists({ tenant: 'default' }, lookup)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('follows DEFAULT_TENANT_SLUG for what counts as the default tenant', async () => {
    vi.stubEnv('DEFAULT_TENANT_SLUG', 'main');
    const lookup = vi.fn<TenantExists>().mockResolvedValue(false);
    await expect(assertTenantExists({ tenant: 'main' }, lookup)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    await expect(assertTenantExists({ tenant: 'default' }, lookup)).rejects.toMatchObject(refusal);
  });

  it.each([undefined, {}, { identity: 'u1' }, [], null, 'x'])('does not look anything up for %j', async (options) => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(false);
    await expect(assertTenantExists(options, lookup)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['', 'Bad Slug', 7, null])('refuses the malformed tenant %j without a lookup', async (tenant) => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    await expect(assertTenantExists({ tenant }, lookup)).rejects.toMatchObject(refusal);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses with a 503 when the lookup fails, instead of letting the request through', async () => {
    const lookup = vi.fn<TenantExists>().mockRejectedValue(new Error('connection refused'));
    await expect(assertTenantExists({ tenant: 'acme' }, lookup)).rejects.toMatchObject({
      code: 503,
      message: 'tenant_lookup_failed',
    });
  });

  it('asks every time: nothing is cached', async () => {
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    await assertTenantExists({ tenant: 'acme' }, lookup);
    await assertTenantExists({ tenant: 'acme' }, lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('createTenantExistsLookup', () => {
  function prismaReturning(row: { id: string } | null) {
    const findUnique = vi.fn().mockResolvedValue(row);
    return { findUnique, prisma: { tenant: { findUnique } } as unknown as PrismaClient };
  }

  it('looks the slug up by its unique index and selects nothing but the id', async () => {
    const { findUnique, prisma } = prismaReturning({ id: 't1' });
    await expect(createTenantExistsLookup(() => prisma)('acme')).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({ where: { slug: 'acme' }, select: { id: true } });
  });

  it('reports a missing tenant', async () => {
    const { prisma } = prismaReturning(null);
    await expect(createTenantExistsLookup(() => prisma)('nope')).resolves.toBe(false);
  });

  it('asks for the client when it needs it, not when it is built', () => {
    const getPrisma = vi.fn<() => PrismaClient>();
    createTenantExistsLookup(getPrisma);
    expect(getPrisma).not.toHaveBeenCalled();
  });
});

describe('installPartitionKeyValidation', () => {
  type Controller = NonNullable<Parameters<typeof installPartitionKeyValidation>[1]>;

  /** A controller whose `invokeMethod` is a spy standing for "Colyseus builds or finds a room". */
  function fakeController() {
    const reached = vi.fn((..._args: unknown[]) => Promise.resolve({ room: { roomId: 'r1' } }));
    const controller = { invokeMethod: reached } as unknown as Controller;
    return { controller, reached };
  }

  it('hands the options on to Colyseus once the tenant checked out', async () => {
    const { controller, reached } = fakeController();
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    installPartitionKeyValidation(lookup, controller);
    await controller.invokeMethod('joinOrCreate', 'world', { tenant: 'acme' }, {});
    expect(lookup).toHaveBeenCalledWith('acme');
    expect(reached).toHaveBeenCalledWith('joinOrCreate', 'world', { tenant: 'acme' }, {});
  });

  it('never reaches Colyseus with a prototype key in the options, and passes on the object it checked', async () => {
    const { controller, reached } = fakeController();
    const lookup = vi.fn<TenantExists>().mockResolvedValue(true);
    installPartitionKeyValidation(lookup, controller);
    const hostile: unknown = JSON.parse('{"__proto__":{"tenant":"zz-evil-1"}}');
    await expect(controller.invokeMethod('joinOrCreate', 'world', hostile, {})).rejects.toMatchObject({
      code: 400,
      message: 'invalid_options',
    });
    expect(reached).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();

    // What reaches Colyseus is the very object that passed the check (no copy that could differ).
    const fine = { tenant: 'acme', identity: 'u1' };
    await controller.invokeMethod('joinOrCreate', 'world', fine, {});
    expect(reached.mock.calls[0]?.[2]).toBe(fine);
  });

  it('never reaches Colyseus for an unknown tenant', async () => {
    const { controller, reached } = fakeController();
    installPartitionKeyValidation(vi.fn<TenantExists>().mockResolvedValue(false), controller);
    await expect(controller.invokeMethod('joinOrCreate', 'world', { tenant: 'nope' }, {})).rejects.toMatchObject({
      code: 400,
      message: 'invalid_tenant',
    });
    expect(reached).not.toHaveBeenCalled();
  });

  it('files an empty tenant under the default tenant without a lookup', async () => {
    const { controller, reached } = fakeController();
    const lookup = vi.fn<TenantExists>().mockResolvedValue(false);
    installPartitionKeyValidation(lookup, controller);
    await controller.invokeMethod('joinOrCreate', 'world', { tenant: '', identity: 'u1' }, {});
    expect(lookup).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledWith('joinOrCreate', 'world', { tenant: 'default', identity: 'u1' }, {});
  });

  it('stops checking once it is uninstalled', async () => {
    const { controller, reached } = fakeController();
    const uninstall = installPartitionKeyValidation(vi.fn<TenantExists>().mockResolvedValue(false), controller);
    await expect(controller.invokeMethod('joinOrCreate', 'world', { tenant: 'nope' }, {})).rejects.toThrow();
    uninstall();
    await controller.invokeMethod('joinOrCreate', 'world', { tenant: 'nope' }, {});
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe('partition key against a real Colyseus server', () => {
  let server: MatchmakeTestServer;
  /** The tenants that "exist" in this suite; everything else is a well-formed slug nobody owns. */
  const knownTenants = new Set(['acme', 'acme-corp', 'team_42', 'a', 'a'.repeat(64), '0', '-']);
  const tenantExists = vi.fn<TenantExists>((slug) => Promise.resolve(knownTenants.has(slug)));

  beforeAll(async () => {
    createPrismaClientMock.mockImplementation(makeFakePrisma);
    server = await startMatchmakeServer({ guard: false, tenantExists });
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
  });

  beforeEach(async () => {
    await disposeAllRooms();
    createPrismaClientMock.mockClear();
    tenantExists.mockClear();
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
    expect(tenantExists).not.toHaveBeenCalled();
  });

  it.each(['no-such-tenant', 'zz'.repeat(32), 'team_43', '0000'])(
    'refuses the well-formed but unknown slug %s and builds no room and no PrismaClient',
    async (tenant) => {
      const res = await matchmake(server, JSON.stringify({ tenant }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ code: 400, error: 'invalid_tenant' });
      expect(tenantExists).toHaveBeenCalledExactlyOnceWith(tenant);
      expect(await worldRooms()).toHaveLength(0);
      expect(createPrismaClientMock).not.toHaveBeenCalled();
    },
  );

  it('does not build a room for any of 50 random unknown slugs', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await matchmake(
        server,
        JSON.stringify({ tenant: `rnd-${i}-${Math.random().toString(36).slice(2)}` }),
      );
      expect(res.status).toBe(400);
    }
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown tenant on every matchmake method: joinOrCreate by its tenant, the others as a method', async () => {
    for (const method of ['create', 'join', 'joinOrCreate']) {
      const res = await matchmake(server, JSON.stringify({ tenant: 'no-such-tenant' }), {
        path: `/matchmake/${method}/world`,
      });
      expect(res.status, method).toBe(400);
      expect(res.body.error, method).toBe(method === 'joinOrCreate' ? 'invalid_tenant' : 'invalid_method');
    }
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('answers 503 and builds no room while the tenant lookup is failing', async () => {
    tenantExists.mockRejectedValueOnce(new Error('connection refused'));
    const res = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 503, error: 'tenant_lookup_failed' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it('refuses a bad tenant on every matchmake method: joinOrCreate by its tenant, the others as a method', async () => {
    for (const method of ['create', 'join', 'joinOrCreate']) {
      const res = await matchmake(server, JSON.stringify({ tenant: 'Bad Slug' }), {
        path: `/matchmake/${method}/world`,
      });
      expect(res.status, method).toBe(400);
      expect(res.body.error, method).toBe(method === 'joinOrCreate' ? 'invalid_tenant' : 'invalid_method');
    }
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ['the body measured by the skeptic', '{"__proto__":{"tenant":"zz-evil-1"}}'],
    ['a 10,000 character tenant inside __proto__', `{"__proto__":{"tenant":"${'a'.repeat(10_000)}"}}`],
    ['a 10,000 character key inside __proto__', `{"__proto__":{"${'k'.repeat(10_000)}":1}}`],
    ['__proto__ next to a valid tenant', '{"tenant":"acme","__proto__":{"tenant":"zz-evil-1"}}'],
    ['constructor', '{"constructor":{"prototype":{"tenant":"zz-evil-1"}}}'],
    ['prototype', '{"prototype":{"tenant":"zz-evil-1"}}'],
    ['hasOwnProperty', '{"hasOwnProperty":1}'],
  ])('refuses %s and builds no room and no PrismaClient', async (_label, body) => {
    const res = await matchmake(server, body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 400, error: 'invalid_options' });
    expect(await worldRooms()).toHaveLength(0);
    expect(createPrismaClientMock).not.toHaveBeenCalled();
    expect(tenantExists).not.toHaveBeenCalled();
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

  it('looks a known tenant up once per request and builds its room', async () => {
    const res = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    expect(res.status).toBe(200);
    expect(tenantExists).toHaveBeenCalledExactlyOnceWith('acme');
  });

  it('builds the default tenant\u2019s room without any lookup, even though no tenant row backs it (OSS)', async () => {
    const res = await matchmake(server, JSON.stringify({ tenant: 'default' }));
    expect(res.status).toBe(200);
    expect(tenantExists).not.toHaveBeenCalled();
    expect((await worldRooms())[0]?.metadata?.tenant).toBe('default');
  });

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
    expect(tenantExists).not.toHaveBeenCalled();
  });

  it('files an empty tenant under the default tenant instead of building a room per request', async () => {
    for (let i = 0; i < 3; i++) expect((await matchmake(server, JSON.stringify({ tenant: '' }))).status).toBe(200);
    expect((await matchmake(server, JSON.stringify({ tenant: 'default' }))).status).toBe(200);
    const rooms = await worldRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.metadata?.tenant).toBe('default');
    expect(createPrismaClientMock).toHaveBeenCalledTimes(1);
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
