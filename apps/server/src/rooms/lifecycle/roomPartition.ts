import { ServerError } from '@colyseus/core';
import { logger } from '../../logger.js';
import type { RoomOptions } from '../WorldRoom.js';
import { AUTH_REJECTED_CODE, isTenantEnforced, type WorldAuth } from './onAuth.js';

/**
 * The room a verified client ended up in must belong to its tenant.
 *
 * `enforceTenantMatch` (onAuth.ts) compares the slug the client SENT with the
 * verified tenant, and deliberately lets a join through when the client sent no
 * slug at all. That is the gap: without `options.tenant` Colyseus applies no
 * partition filter, so the joiner lands in the first room it finds, which is
 * usually another tenant's (measured: a member of tenant beta without a tenant
 * option joined acme's room). The authoritative fact is the room's own tenant,
 * `room.metadata.tenant`, so that is what this compares, for exactly the joins
 * `enforceTenantMatch` skips.
 *
 * Same flag as `enforceTenantMatch` (ZONE_PRIVACY_TENANT_ENFORCE, see
 * isTenantEnforced), on by default: the mismatch is refused. Only an explicit
 * `false` admits it with a warning. The StateView filter and seat counting do
 * not cover room-wide messages, so this check is what keeps a foreign client
 * out of them.
 *
 * A join that carries no verified tenant (NPCs, which carry no session) has
 * nothing to compare and is left alone.
 */
export function enforceRoomPartition(
  options: RoomOptions | undefined,
  auth: WorldAuth,
  roomTenant: string | undefined,
): void {
  if (!auth.tenantSlug || !roomTenant || auth.tenantSlug === roomTenant) return;
  // A slug the client sent was already compared with the verified tenant.
  if (options?.tenant) return;

  const detail = { identity: auth.identity, authenticated: auth.tenantSlug, room: roomTenant };
  if (isTenantEnforced()) {
    logger.warn('[WorldRoom] Rejected join: no tenant requested and the room belongs to another tenant', detail);
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_mismatch');
  }
  logger.warn('[WorldRoom] Admitted join into a room of another tenant, no tenant requested (enforcement off)', detail);
}
