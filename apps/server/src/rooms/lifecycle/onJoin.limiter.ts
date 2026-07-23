import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getTenancyModule, OSS_USER_LIMIT } from '../../tenancyLoader.js';
import { getBillingModuleSync } from '../../billingLoader.js';
import type { WorldRoom, RoomOptions } from '../WorldRoom.js';

export interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

// Minimal read-shape of a Colyseus Player for counting purposes.
interface CountablePlayer {
  identity?: string;
  isNpc?: boolean;
}

// NPCs are server-controlled infrastructure (npc-service), not billable
// participants. They must never count toward the OSS global limit, the
// per-tenant seat cap or the canonical concurrency metric (E3.2). Both the
// schema flag and the reserved `npc-` identity prefix are checked so an
// NPC is excluded even if only one signal is present.
function isNpcPlayer(p: CountablePlayer): boolean {
  return p.isNpc === true || (p.identity ?? '').startsWith('npc-');
}

// Count all active non-NPC player sessions across all rooms (global OSS
// limit). NPCs are excluded (E3.2); this is the session count that backs the
// self-hosted OSS_USER_LIMIT ceiling.
export function countTotalActivePlayers(activeRooms: Set<WorldRoom>): number {
  let totalActive = 0;
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      try {
        r.state?.players?.forEach((p: CountablePlayer) => {
          if (!isNpcPlayer(p)) totalActive++;
        });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to get player count from room', e);
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to count total active users', e);
  }
  return totalActive;
}

// Enforce OSS user limit (25 concurrent users for self-hosted OSS).
// Returns true if the join was aborted (and the client was kicked).
export async function enforceOssLimit(activeRooms: Set<WorldRoom>, client: Client): Promise<boolean> {
  try {
    const tenancyModule = await getTenancyModule();
    const hasEnterpriseLicense = tenancyModule.bypassOssLimit?.() ?? false;
    if (hasEnterpriseLicense) return false;

    const totalActive = countTotalActivePlayers(activeRooms);
    if (totalActive >= OSS_USER_LIMIT) {
      try {
        logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to log OSS limit warning', e);
      }
      try {
        client.error(4002, 'oss_limit_reached');
      } catch (e) {
        logger.debug('[WorldRoom] Failed to send error to client', e);
      }
      client.leave(1000);
      return true;
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to check OSS user limit in onJoin', e);
  }
  return false;
}

// Check trial + dunning state via the enterprise billing module.
// Returns true if the join was aborted (and the client was kicked).
// Exported for unit testing. Not part of the public API.
export async function checkBillingStatus(
  client: Client,
  prisma: PrismaClient,
  tenant: { id: string; bypassLimits: boolean } | null,
  tenantSlug: string,
): Promise<boolean> {
  const billingMod = getBillingModuleSync();
  // F6 (bypassLimits precedence): a bypassLimits tenant is evaluated BEFORE any
  // status-based rejection, so it can never be blocked by trial/dunning state.
  if (!billingMod || !tenant || tenant.bypassLimits) return false;
  try {
    const trialStatus = await billingMod.getTrialStatus(prisma, tenant.id);
    if (trialStatus.status === 'expired') {
      try {
        logger.warn('[WorldRoom] Tenant trial expired', { tenant: tenantSlug });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to log trial expiry', e);
      }
      try {
        client.error(4005, 'trial_expired');
      } catch (e) {
        logger.debug('[WorldRoom] Failed to send trial_expired error', e);
      }
      try {
        await prisma.$disconnect().catch(() => {});
      } catch (e) {
        logger.debug('[WorldRoom] Failed to disconnect prisma', e);
      }
      client.leave(1000);
      return true;
    }
    const dunningStatus = await billingMod.getDunningStatus(prisma, tenant.id);
    if (dunningStatus.status === 'suspended') {
      try {
        logger.warn('[WorldRoom] Tenant subscription suspended', { tenant: tenantSlug });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to log subscription suspension', e);
      }
      try {
        client.error(4004, 'subscription_suspended');
      } catch (e) {
        logger.debug('[WorldRoom] Failed to send subscription_suspended error', e);
      }
      try {
        await prisma.$disconnect().catch(() => {});
      } catch (e) {
        logger.debug('[WorldRoom] Failed to disconnect prisma', e);
      }
      client.leave(1000);
      return true;
    }
  } catch (e) {
    logger.debug('[WorldRoom] Billing status check failed (non-blocking)', e);
  }
  return false;
}

// Collect the distinct, non-NPC identities currently present for a tenant,
// aggregated across ALL rooms backing that tenant (E3.1/E3.2). This is the
// canonical concurrency set: one identity = one connection, regardless of how
// many room shards or sessions it appears in. Exported for unit testing.
export function collectActiveIdentitiesForTenant(activeRooms: Set<WorldRoom>, tenantSlug: string): Set<string> {
  const identities = new Set<string>();
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      const meta = (r.metadata as RoomMetadata) || {};
      if (meta && meta.tenant === tenantSlug) {
        try {
          r.state?.players?.forEach((p: CountablePlayer) => {
            const identity = p.identity;
            if (identity && !isNpcPlayer(p)) identities.add(identity);
          });
        } catch (e) {
          logger.debug('[WorldRoom] Failed to get active identities from room', e);
        }
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to collect active identities for tenant', e);
  }
  return identities;
}

// Count distinct active non-NPC identities for a tenant slug (E3.2). Wraps
// the canonical identity set. Exported for unit testing.
export function countActiveForTenant(activeRooms: Set<WorldRoom>, tenantSlug: string): number {
  return collectActiveIdentitiesForTenant(activeRooms, tenantSlug).size;
}

// Enforce per-tenant seat limit. Returns true if the join was aborted
// (and the client was kicked).
// Exported for unit testing. Not part of the public API.
export async function enforceTenantSeatLimit(
  client: Client,
  prisma: PrismaClient,
  activeRooms: Set<WorldRoom>,
  tenant: { concurrentLimit: number | null; freeSeats: number | null },
  tenantSlug: string,
  joiningIdentity: string,
): Promise<boolean> {
  const activeIdentities = collectActiveIdentitiesForTenant(activeRooms, tenantSlug);
  const active = activeIdentities.size;
  const tenancy = await getTenancyModule();
  const bypassOssLimit = tenancy.bypassOssLimit?.() ?? false;

  if (!bypassOssLimit) {
    const totalActive = countTotalActivePlayers(activeRooms);
    if (totalActive >= OSS_USER_LIMIT) {
      try {
        logger.warn('[WorldRoom] OSS user limit reached', { totalActive, limit: OSS_USER_LIMIT });
      } catch (e) {
        logger.debug('[WorldRoom] Failed to log OSS limit', e);
      }
      try {
        client.error(4002, 'oss_limit_reached');
      } catch (e) {
        logger.debug('[WorldRoom] Failed to send oss_limit_reached error', e);
      }
      try {
        await prisma.$disconnect().catch(() => {});
      } catch (e) {
        logger.debug('[WorldRoom] Failed to disconnect prisma', e);
      }
      client.leave(1000);
      return true;
    }
  }

  const paidSeats = Math.max(0, tenant.concurrentLimit || 0);
  const freeSeats = Math.max(0, tenant.freeSeats || 0);
  const effectiveLimit = Math.max(paidSeats, freeSeats);
  // Self-exempt (E3.3): if the joining identity is ALREADY present, this join
  // replaces its own connection (newest-wins) instead of adding a slot, so it
  // must never be rejected by the seat cap. A reconnect therefore consumes no
  // additional slot. This exemption applies to the seat cap ONLY; the billing
  // gate (checkBillingStatus) already ran unconditionally before this.
  //
  // Cap-0 exception (E4.3): effectiveLimit === 0 means zero seats — a terminal
  // state, i.e. a voluntarily canceled tenant. Self-exempt is deliberately
  // WITHHELD there so that already-present identities also fall under the
  // reject: canceled == no access, even on reconnect. Otherwise a present user
  // could reconnect indefinitely and freeload past cancellation. This case is
  // NOT covered by the billing gate (voluntary cancellation leaves trial not
  // 'expired' and dunning not 'suspended'), so the cap-0 reject here is the only
  // barrier. A soft downgrade (effectiveLimit > 0 but active > effectiveLimit)
  // keeps the previous behaviour and retains already-present users via
  // self-exempt.
  const selfExempt = effectiveLimit > 0 && activeIdentities.has(joiningIdentity);
  if (!selfExempt && active >= effectiveLimit) {
    try {
      logger.warn('[WorldRoom] Tenant limit reached', {
        tenant: tenantSlug,
        active,
        limit: effectiveLimit,
        paidSeats,
        freeSeats,
      });
    } catch (e) {
      logger.debug('[WorldRoom] Failed to log tenant limit', e);
    }
    try {
      client.error(4001, 'tenant_limit_reached');
    } catch (e) {
      logger.debug('[WorldRoom] Failed to send tenant_limit_reached error', e);
    }
    try {
      await prisma.$disconnect().catch(() => {});
    } catch (e) {
      logger.debug('[WorldRoom] Failed to disconnect prisma', e);
    }
    client.leave(1000);
    return true;
  }
  return false;
}

// Combined per-tenant limits: billing status + seat limit. Returns
// true if the join was aborted.
//
// Gate order (E3.3): the billing gate runs UNCONDITIONALLY and FIRST — even
// for a session takeover — so an expired/suspended tenant is rejected before
// the seat cap is even considered. Only afterwards does the seat cap run, with
// its self-exempt for the already-present joining identity (E3.4/N4).
export async function enforceTenantLimits(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  options: RoomOptions | undefined,
  client: Client,
  joiningIdentity: string,
): Promise<boolean> {
  try {
    const tenantSlug: string =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prisma = createPrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

    if (await checkBillingStatus(client, prisma, tenant, tenantSlug)) return true;

    if (tenant && !tenant.bypassLimits) {
      if (await enforceTenantSeatLimit(client, prisma, activeRooms, tenant, tenantSlug, joiningIdentity)) return true;
    }
    try {
      await prisma.$disconnect().catch(() => {});
    } catch (e) {
      logger.debug('[WorldRoom] Failed to disconnect prisma', e);
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to enforce tenant/user limits', e);
  }
  return false;
}
