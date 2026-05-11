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

// Count all active players across all rooms (global OSS limit).
export function countTotalActivePlayers(activeRooms: Set<WorldRoom>): number {
  let totalActive = 0;
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      try {
        totalActive += r.state?.players?.size || 0;
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
async function checkBillingStatus(
  client: Client,
  prisma: PrismaClient,
  tenant: { id: string; bypassLimits: boolean } | null,
  tenantSlug: string,
): Promise<boolean> {
  const billingMod = getBillingModuleSync();
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

// Count active players for a specific tenant slug.
function countActiveForTenant(activeRooms: Set<WorldRoom>, tenantSlug: string): number {
  let active = 0;
  try {
    const rooms = Array.from(activeRooms.values());
    for (const r of rooms) {
      const meta = (r.metadata as RoomMetadata) || {};
      if (meta && meta.tenant === tenantSlug) {
        try {
          active += r.state?.players?.size || 0;
        } catch (e) {
          logger.debug('[WorldRoom] Failed to get active count from room', e);
        }
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to count active users for tenant', e);
  }
  return active;
}

// Enforce per-tenant seat limit. Returns true if the join was aborted
// (and the client was kicked).
async function enforceTenantSeatLimit(
  client: Client,
  prisma: PrismaClient,
  activeRooms: Set<WorldRoom>,
  tenant: { concurrentLimit: number | null; freeSeats: number | null },
  tenantSlug: string,
): Promise<boolean> {
  const active = countActiveForTenant(activeRooms, tenantSlug);
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
  if (active >= effectiveLimit) {
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
export async function enforceTenantLimits(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  options: RoomOptions | undefined,
  client: Client,
): Promise<boolean> {
  try {
    const tenantSlug: string =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prisma = createPrismaClient();
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

    if (await checkBillingStatus(client, prisma, tenant, tenantSlug)) return true;

    if (tenant && !tenant.bypassLimits) {
      if (await enforceTenantSeatLimit(client, prisma, activeRooms, tenant, tenantSlug)) return true;
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
