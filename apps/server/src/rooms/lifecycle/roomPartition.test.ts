/**
 * The room a verified client joined must belong to its tenant, for the joins
 * `enforceTenantMatch` skips (no tenant option). Unit tests for the rule, plus
 * the wiring through `WorldRoom.onAuth` on a real Colyseus room (see
 * testUtils/matchmakeHarness.ts) with a real signed session token.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ServerError, matchMaker, type AuthContext, type Client } from '@colyseus/core';

const warn = vi.hoisted(() => vi.fn());
vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
}));

const createPrismaClientMock = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ createPrismaClient: createPrismaClientMock }));

import {
  disposeAllRooms,
  makeFakePrisma,
  matchmake,
  startMatchmakeServer,
  stopMatchmakeServer,
  type MatchmakeTestServer,
} from '../../testUtils/matchmakeHarness.js';
import { enforceRoomPartition } from './roomPartition.js';
import { AUTH_REJECTED_CODE, type WorldAuth } from './onAuth.js';
import type { WorldRoom } from '../WorldRoom.js';

const verified = (tenantSlug?: string): WorldAuth => ({
  identity: 'user-1',
  isNpc: false,
  zonePrivacyVersion: 1,
  ...(tenantSlug ? { tenantId: `tid-${tenantSlug}`, tenantSlug } : {}),
});

describe('enforceRoomPartition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockClear();
  });

  it('lets a join into its own tenant’s room through silently', () => {
    expect(() => enforceRoomPartition(undefined, verified('acme'), 'acme')).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('admits a tenant-less join into another tenant’s room with a warning while enforcement is off', () => {
    expect(() => enforceRoomPartition({}, verified('beta'), 'acme')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no tenant requested'),
      expect.objectContaining({ authenticated: 'beta', room: 'acme' }),
    );
  });

  it('refuses it as tenant_mismatch (4401) once ZONE_PRIVACY_TENANT_ENFORCE is on', () => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'true');
    for (const options of [undefined, {}, { tenant: '' }]) {
      try {
        enforceRoomPartition(options, verified('beta'), 'acme');
        expect.unreachable('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(ServerError);
        expect(error).toMatchObject({ code: AUTH_REJECTED_CODE, message: 'tenant_mismatch' });
      }
    }
  });

  it('leaves a join that named a tenant to enforceTenantMatch', () => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'true');
    expect(() => enforceRoomPartition({ tenant: 'acme' }, verified('beta'), 'acme')).not.toThrow();
  });

  it('has nothing to compare for a join without a verified tenant', () => {
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'true');
    expect(() => enforceRoomPartition(undefined, verified(), 'acme')).not.toThrow();
    expect(() => enforceRoomPartition(undefined, verified('beta'), undefined)).not.toThrow();
  });
});

describe('WorldRoom.onAuth with a verified session', () => {
  const SECRET = 'x'.repeat(40);
  let server: MatchmakeTestServer;

  const tenantRows: Record<string, { slug: string }> = { 'tid-beta': { slug: 'beta' } };

  /** A signed token for `userId` of tenant beta plus the session row the room's prisma will return. */
  function sessionFor(userId: string): { token: string; context: AuthContext } {
    const token = jwt.sign({ sub: userId, tid: 'tid-beta', jti: crypto.randomUUID() }, SECRET, { expiresIn: '1h' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    sessions.set(tokenHash, {
      id: `sess-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      lastActiveAt: new Date(),
    });
    return { token, context: { token, headers: new Headers(), ip: '203.0.113.9' } };
  }
  const sessions = new Map<string, { id: string; userId: string; expiresAt: Date; lastActiveAt: Date }>();

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    createPrismaClientMock.mockImplementation(() => ({
      ...makeFakePrisma(),
      tenant: {
        findUnique: ({ where }: { where: { id?: string } }) => Promise.resolve(tenantRows[where.id ?? ''] ?? null),
      },
      session: {
        findUnique: ({ where }: { where: { tokenHash: string } }) =>
          Promise.resolve(sessions.get(where.tokenHash) ?? null),
        update: () => Promise.resolve({}),
      },
    }));
    server = await startMatchmakeServer();
  });

  afterAll(async () => {
    await stopMatchmakeServer(server);
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await disposeAllRooms();
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('JWT_SECRET', SECRET);
  });

  async function acmeRoom(): Promise<WorldRoom> {
    const res = await matchmake(server, JSON.stringify({ tenant: 'acme' }));
    const room = matchMaker.getLocalRoomById(res.body.roomId ?? '');
    return room as WorldRoom;
  }
  const client = {} as Client;

  it('admits a member of another tenant that sent no tenant into acme’s room while enforcement is off', async () => {
    const room = await acmeRoom();
    const { context } = sessionFor('user-1');
    const auth = await room.onAuth(client, { zonePrivacyVersion: 1 }, context);
    expect(auth.tenantSlug).toBe('beta');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no tenant requested'), expect.anything());
  });

  it('refuses it once ZONE_PRIVACY_TENANT_ENFORCE is on', async () => {
    const room = await acmeRoom();
    const { context } = sessionFor('user-2');
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'true');
    await expect(room.onAuth(client, { zonePrivacyVersion: 1 }, context)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'tenant_mismatch',
    });
  });

  it('keeps refusing a named foreign tenant when enforcement is on (existing check)', async () => {
    const room = await acmeRoom();
    const { context } = sessionFor('user-3');
    vi.stubEnv('ZONE_PRIVACY_TENANT_ENFORCE', 'true');
    await expect(room.onAuth(client, { tenant: 'acme', zonePrivacyVersion: 1 }, context)).rejects.toMatchObject({
      message: 'tenant_mismatch',
    });
  });
});
