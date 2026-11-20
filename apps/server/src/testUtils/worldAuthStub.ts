import { vi, type MockInstance } from 'vitest';
import { WorldRoom } from '../rooms/WorldRoom.js';
import type { WorldAuth } from '../rooms/lifecycle/onAuth.js';

let signedIn = 0;

/** A signed-in member of `tenant`, shaped like the result of the static world auth. */
export function memberAuth(tenant: unknown): WorldAuth {
  signedIn += 1;
  return {
    identity: `user-${signedIn}`,
    tenantId: `tenant-${typeof tenant === 'string' ? tenant : 'default'}`,
    tenantSlug: typeof tenant === 'string' ? tenant : undefined,
    sessionId: `session-${signedIn}`,
    authSessionId: `session-${signedIn}`,
    isNpc: false,
    zonePrivacyVersion: 0,
  };
}

/**
 * Matchmaking runs the static world auth before it reserves a seat. Tests
 * that are about something else act as a member of the tenant they ask for.
 * Restore the returned spy after each test.
 */
export function stubWorldAuth(): MockInstance<typeof WorldRoom.onAuth> {
  return vi
    .spyOn(WorldRoom, 'onAuth')
    .mockImplementation((_token, options) => Promise.resolve(memberAuth(options?.tenant)));
}
