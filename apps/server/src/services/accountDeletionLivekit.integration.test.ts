/**
 * Account deletion removes a user from a foreign tenant's LiveKit world
 * room at once: the user is a participant in `<slugB>:world` without a
 * membership in tenant B, and after `deleteAccount` must be gone from the
 * participant list within 10 s. The periodic reconciler is deliberately
 * not started here, so only the immediate revocation path can remove the
 * participant well inside its 30 s interval.
 *
 * Presence is always the admin participant list, as in the AV revocation
 * integration test. Same stack assumptions: a migrated test database and
 * a real test SFU.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { deleteAccount } from './accountDeletion.js';
import { stopAvPendingRevocations } from '../rooms/lifecycle/avPendingRevocations.js';
import { cleanupTenants, seedMember, seedTenant } from '../testUtils/worldSeed.js';
import {
  connectParticipant,
  disconnectAll,
  listIdentities,
  mintServiceToken,
  waitForIdentityGone,
  waitForIdentityPresent,
} from '../testUtils/sfuHarness.js';

const FILE = 'accountDeletionLivekit.integration.test.ts';
const REMOVAL_TIMEOUT_MS = 10_000;
const SFU_TIMEOUT_MS = 60_000;

function requireEnv(name: string, purpose: string): void {
  if (!process.env[name]) throw new Error(`${FILE} needs ${name} ${purpose}`);
}

requireEnv('DATABASE_URL', 'pointing at a migrated test database');
requireEnv('LIVEKIT_URL', 'pointing at the test SFU');
requireEnv('LIVEKIT_API_KEY', 'for the test SFU');
requireEnv('LIVEKIT_API_SECRET', 'for the test SFU');
requireEnv('TEST_SFU_CONTAINER', 'naming the test SFU container');

const prisma = createPrismaClient();
const tenantIds: string[] = [];
let userId = '';

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function worldName(slug: string): string {
  return `${slug}:world`;
}

afterAll(async () => {
  await disconnectAll();
  await stopAvPendingRevocations();
  await cleanupTenants(prisma, tenantIds);
  await prisma.$disconnect();
});

describe('account deletion in a foreign tenant livekit room', () => {
  it(
    'removes the participant within ten seconds without the reconciler',
    async () => {
      const home = await seedTenant(prisma, { slug: `home-${shortId()}` });
      const foreign = await seedTenant(prisma, { slug: `foreign-${shortId()}` });
      tenantIds.push(home.id, foreign.id);
      const member = await seedMember(prisma, home.id);
      userId = member.userId;

      const foreignMembership = await prisma.membership.findFirst({
        where: { userId, tenantId: foreign.id },
        select: { id: true },
      });
      expect(foreignMembership).toBeNull();

      await connectParticipant(await mintServiceToken(worldName(foreign.slug), userId));
      expect(await waitForIdentityPresent(worldName(foreign.slug), userId, REMOVAL_TIMEOUT_MS)).toBe(true);

      await deleteAccount(prisma, userId);

      expect(await waitForIdentityGone(worldName(foreign.slug), userId, REMOVAL_TIMEOUT_MS)).toBe(true);
      expect(await listIdentities(worldName(foreign.slug))).not.toContain(userId);
    },
    SFU_TIMEOUT_MS,
  );
});
