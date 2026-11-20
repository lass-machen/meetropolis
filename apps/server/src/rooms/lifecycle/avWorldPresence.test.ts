import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldRoom } from '../WorldRoom.js';
import type { WorldAccessEntry } from './worldAccess.js';
import { isAvWorldPresenceCurrent, resolveAvWorldPresence } from './avWorldPresence.js';

const BASE_NOW = 1_790_000_000_000;

interface RoomOpts {
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  tenantSlug?: string;
  authSessionId?: string | null;
  epoch?: number;
  leaseUntil?: number | null;
  accessExpiresAt?: number | null;
  withClient?: boolean;
  withPlayer?: boolean;
  playerIdentity?: string;
  playerIsNpc?: boolean;
  withEntry?: boolean;
}

function makeEntry(overrides: Partial<WorldAccessEntry> & { sessionId: string }): WorldAccessEntry {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    authSessionId: 'login-1',
    epoch: 3,
    leaseUntil: BASE_NOW + 60_000,
    accessExpiresAt: null,
    ...overrides,
  };
}

function makeRoom(opts: RoomOpts = {}): { room: WorldRoom; entry: WorldAccessEntry | undefined } {
  const sessionId = opts.sessionId ?? 'sess-1';
  const entry =
    opts.withEntry === false
      ? undefined
      : makeEntry({
          sessionId,
          userId: opts.userId ?? 'user-1',
          tenantId: opts.tenantId ?? 'tenant-1',
          tenantSlug: opts.tenantSlug ?? 'tenant-1',
          authSessionId: opts.authSessionId === undefined ? 'login-1' : opts.authSessionId,
          epoch: opts.epoch ?? 3,
          leaseUntil: opts.leaseUntil === undefined ? BASE_NOW + 60_000 : opts.leaseUntil,
          accessExpiresAt: opts.accessExpiresAt === undefined ? null : opts.accessExpiresAt,
        });
  const byId = new Map<string, WorldAccessEntry>();
  if (entry) byId.set(sessionId, entry);
  const players = new Map<string, { identity: string; isNpc?: boolean }>();
  if (opts.withPlayer !== false) {
    players.set(sessionId, {
      identity: opts.playerIdentity ?? 'user-1',
      isNpc: opts.playerIsNpc ?? false,
    });
  }
  const room = {
    clients: (opts.withClient === false ? [] : [{ sessionId }]) as unknown as WorldRoom['clients'],
    state: { players } as unknown as WorldRoom['state'],
    worldAccess: { entryFor: (id: string) => byId.get(id) } as unknown as WorldRoom['worldAccess'],
  } as unknown as WorldRoom;
  return { room, entry };
}

function setRooms(rooms: WorldRoom[]): void {
  (globalThis as { activeWorldRooms?: Set<WorldRoom> }).activeWorldRooms = new Set(rooms);
}

function makeMultiRoom(defs: RoomOpts[]): { room: WorldRoom; entries: WorldAccessEntry[] } {
  const byId = new Map<string, WorldAccessEntry>();
  const players = new Map<string, { identity: string; isNpc?: boolean }>();
  const clients: Array<{ sessionId: string }> = [];
  const entries: WorldAccessEntry[] = [];
  defs.forEach((def, index) => {
    const sessionId = def.sessionId ?? `sess-${index + 1}`;
    if (def.withEntry !== false) {
      const entry = makeEntry({
        sessionId,
        userId: def.userId ?? 'user-1',
        tenantId: def.tenantId ?? 'tenant-1',
        tenantSlug: def.tenantSlug ?? 'tenant-1',
        authSessionId: def.authSessionId === undefined ? 'login-1' : def.authSessionId,
        epoch: def.epoch ?? 3,
        leaseUntil: def.leaseUntil === undefined ? BASE_NOW + 60_000 : def.leaseUntil,
        accessExpiresAt: def.accessExpiresAt === undefined ? null : def.accessExpiresAt,
      });
      byId.set(sessionId, entry);
      entries.push(entry);
    }
    if (def.withPlayer !== false) {
      players.set(sessionId, {
        identity: def.playerIdentity ?? 'user-1',
        isNpc: def.playerIsNpc ?? false,
      });
    }
    if (def.withClient !== false) clients.push({ sessionId });
  });
  const room = {
    clients: clients as unknown as WorldRoom['clients'],
    state: { players } as unknown as WorldRoom['state'],
    worldAccess: { entryFor: (id: string) => byId.get(id) } as unknown as WorldRoom['worldAccess'],
  } as unknown as WorldRoom;
  return { room, entries };
}

const subject = { userId: 'user-1', authSessionId: 'login-1', tenantId: 'tenant-1', tenantSlug: 'tenant-1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
});

afterEach(() => {
  (globalThis as { activeWorldRooms?: Set<WorldRoom> }).activeWorldRooms = undefined;
  vi.useRealTimers();
});

describe('resolveAvWorldPresence', () => {
  it('resolves the single matching materialized human world session', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    expect(proof?.room).toBe(room);
    expect(proof?.colyseusSessionId).toBe('sess-1');
    expect(proof?.entry).toBe(entry);
    expect(proof?.epoch).toBe(3);
  });

  it('uses Date.now() when now is omitted', () => {
    const { room } = makeRoom();
    setRooms([room]);
    expect(resolveAvWorldPresence(subject)).not.toBeNull();
  });

  it('denies on wrong tenant, slug, user, or login session', () => {
    const cases = [
      { tenantId: 'other-tenant' },
      { tenantSlug: 'other-slug' },
      { userId: 'other-user' },
      { authSessionId: 'other-login' },
    ];
    for (const override of cases) {
      const { room } = makeRoom();
      setRooms([room]);
      expect(resolveAvWorldPresence({ ...subject, ...override }, BASE_NOW)).toBeNull();
    }
  });

  it('denies a pending-only entry without a published player', () => {
    const { room } = makeRoom({ withPlayer: false });
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies a player identity that does not match the user', () => {
    const { room } = makeRoom({ playerIdentity: 'someone-else' });
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies when the live client is missing', () => {
    const { room } = makeRoom({ withClient: false });
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies NPC players', () => {
    const { room } = makeRoom({ playerIsNpc: true });
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies null, expired, or NaN leases', () => {
    for (const leaseUntil of [null, BASE_NOW - 1_000, Number.NaN]) {
      const { room } = makeRoom({ leaseUntil });
      setRooms([room]);
      expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
    }
  });

  it('denies an expired access deadline', () => {
    const { room } = makeRoom({ accessExpiresAt: BASE_NOW - 1_000 });
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies two matching sessions as ambiguous', () => {
    const first = makeRoom({ sessionId: 'sess-1' });
    const second = makeRoom({ sessionId: 'sess-2' });
    setRooms([first.room, second.room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies when the registry is missing', () => {
    const { room } = makeRoom();
    (room as { worldAccess?: unknown }).worldAccess = undefined;
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies when no world room is active', () => {
    setRooms([]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
    (globalThis as { activeWorldRooms?: Set<WorldRoom> }).activeWorldRooms = undefined;
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies two matching sessions in the same room as ambiguous', () => {
    const { room } = makeMultiRoom([{}, {}]);
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies when the entry sessionId does not match the client key', () => {
    const { room, entry } = makeRoom();
    const foreign = { ...entry!, sessionId: 'sess-9' };
    (
      room as unknown as {
        worldAccess: { entryFor: (id: string) => WorldAccessEntry | undefined };
      }
    ).worldAccess.entryFor = () => foreign;
    setRooms([room]);
    expect(resolveAvWorldPresence(subject, BASE_NOW)).toBeNull();
  });

  it('denies empty subject fields fail-closed', () => {
    const { room } = makeRoom();
    setRooms([room]);
    const empties = [{ userId: '' }, { authSessionId: '' }, { tenantId: '' }, { tenantSlug: '' }];
    for (const override of empties) {
      expect(resolveAvWorldPresence({ ...subject, ...override }, BASE_NOW)).toBeNull();
    }
  });
});

describe('isAvWorldPresenceCurrent', () => {
  it('confirms the pinned proof while presence holds', () => {
    const { room } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(true);
  });

  it('rejects after the player leaves', () => {
    const { room } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    room.state.players.delete('sess-1');
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects after an epoch change', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    entry!.epoch = 4;
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects a replaced entry object with the same values', () => {
    const holder = makeRoom();
    setRooms([holder.room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    const replacement = makeRoom();
    setRooms([replacement.room]);
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects after the lease lapses', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    entry!.leaseUntil = BASE_NOW - 1;
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW + 60_000)).toBe(false);
  });

  it('rejects a proof when a second matching session appears later', () => {
    const first = makeRoom({ sessionId: 'sess-1' });
    setRooms([first.room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    const second = makeRoom({ sessionId: 'sess-2' });
    setRooms([first.room, second.room]);
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects a mutated login session on the same entry without epoch change', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    entry!.authSessionId = 'other-login';
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects a mutated tenant slug on the same entry without epoch change', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    entry!.tenantSlug = 'other-slug';
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });

  it('rejects a mutated user binding even when the player follows', () => {
    const { room, entry } = makeRoom();
    setRooms([room]);
    const proof = resolveAvWorldPresence(subject, BASE_NOW);
    expect(proof).not.toBeNull();
    entry!.userId = 'user-2';
    room.state.players.set('sess-1', { identity: 'user-2' } as never);
    expect(isAvWorldPresenceCurrent(proof, BASE_NOW)).toBe(false);
  });
});
