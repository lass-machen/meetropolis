import type express from 'express';
import { z } from 'zod';
import { isPlayerVisibleToTenant } from '../../rooms/lifecycle/tenantView.js';

/** Minimal shape we require from a Colyseus room for broadcasting controls. */
interface BroadcastableRoom {
  broadcast?: (event: string, data: unknown) => void;
}

/** A seated player, as much of it as the authorization below needs. */
interface SeatedPlayer {
  identity?: string;
  isNpc?: boolean;
}

/**
 * A registered world room, as much of it as the authorization below needs.
 *
 * `playerTenantKey` maps a sessionId to the JWT-verified tenant of that seat.
 * It exists because ONE `WorldRoom` can hold players of several tenants (see
 * `rooms/lifecycle/tenantView.ts`): on the apex domain the room is partitioned
 * by the client-supplied `options.tenant`, which is `'default'` for everyone,
 * and the tenant boundary is drawn per client by a `StateView` filter rather
 * than by separate rooms. Sharing a room is therefore NOT evidence of sharing
 * a tenant, and this file must not treat it as such.
 */
interface ControlWorldRoom extends BroadcastableRoom {
  state?: {
    players?: { forEach?: (cb: (player: SeatedPlayer, sessionId: string) => void) => void };
  };
  playerTenantKey?: Map<string, string>;
}

/**
 * The seat `identity` holds in `room`, or null when it holds none.
 *
 * `state.players` is a Colyseus `MapSchema` keyed by sessionId; the user id
 * lives in `player.identity` (assigned in `rooms/lifecycle/onJoin.completion.ts`
 * from the verified join identity). Iterating with `forEach` matches how the
 * rest of the server reads that map (see `computeOnlineUsageByTenantSlug`).
 */
function findSeat(room: ControlWorldRoom, identity: string): { isNpc: boolean; tenantKey: string | undefined } | null {
  let seat: { isNpc: boolean; tenantKey: string | undefined } | null = null;
  try {
    room.state?.players?.forEach?.((player, sessionId) => {
      if (seat || !player || player.identity !== identity) return;
      seat = { isNpc: player.isNpc === true, tenantKey: room.playerTenantKey?.get(sessionId) };
    });
  } catch {}
  return seat;
}

/** Every registered world room. Empty when the game server has not booted. */
function listWorldRooms(): ControlWorldRoom[] {
  const activeWorldRooms = global.activeWorldRooms;
  if (!activeWorldRooms || activeWorldRooms.size === 0) return [];
  try {
    return Array.from(activeWorldRooms);
  } catch {
    return [];
  }
}

type ControlTargets = { rooms: ControlWorldRoom[] } | { error: 'caller_not_in_a_world_room' | 'target_not_reachable' };

/**
 * Which rooms may a control broadcast from `callerId` reach?
 *
 * Both routes below used to fan out over EVERY registered world room after
 * checking nothing but "is this request authenticated at all". Any logged-in
 * user could therefore mute any user of any tenant whose id they knew — the id
 * is visible in the roster of every shared room — and the untargeted variant
 * silenced every participant of the entire deployment at once. The client-side
 * filter is no defence: it only drops payloads not addressed to itself
 * (`realtime/handlers/remoteControlHandlers.ts`) and cannot judge whether the
 * sender had any authority.
 *
 * The rule now enforced is the narrowest one that keeps the feature working:
 * a caller may only reach a room it is seated in itself, and a targeted mute
 * additionally requires the target to be seated in that same room AND visible
 * to the caller under the room's tenant filter — the same predicate the state
 * sync uses, so a target the caller cannot even see cannot be muted either. An
 * unknown tenant key on either side fails closed.
 *
 * Note what this does NOT decide: whether force-mute should be a moderator
 * privilege rather than something every participant may do to every other
 * participant. The button in `ui/user/card/ExpandedCard.tsx` is ungated for all
 * users, and answering that is a product decision, not a bug fix.
 */
function resolveControlTargets(callerId: string, targetId?: string): ControlTargets {
  const callerRooms: Array<{ room: ControlWorldRoom; callerKey: string | undefined }> = [];
  for (const room of listWorldRooms()) {
    const seat = findSeat(room, callerId);
    if (seat) callerRooms.push({ room, callerKey: seat.tenantKey });
  }
  if (callerRooms.length === 0) return { error: 'caller_not_in_a_world_room' };
  if (targetId === undefined) return { rooms: callerRooms.map((entry) => entry.room) };

  const rooms: ControlWorldRoom[] = [];
  for (const { room, callerKey } of callerRooms) {
    if (callerKey === undefined) continue;
    const targetSeat = findSeat(room, targetId);
    if (!targetSeat) continue;
    if (!isPlayerVisibleToTenant(targetSeat.isNpc, targetSeat.tenantKey, callerKey)) continue;
    rooms.push(room);
  }
  if (rooms.length === 0) return { error: 'target_not_reachable' };
  return { rooms };
}

/**
 * Restrictive-only payload: these broadcast paths may only carry protective
 * actions (disabling a device). Enabling mic/cam/share on a remote peer, or
 * setting their DND at all, is not a legitimate use case here, so `false` is
 * the only accepted value and `dnd` is rejected outright. The single legitimate
 * consumer is force-mute ({ mic: false }).
 */
const controlPayloadSchema = z
  .object({
    mic: z.literal(false).optional(),
    cam: z.literal(false).optional(),
    share: z.literal(false).optional(),
  })
  .strict()
  .refine((v) => v.mic !== undefined || v.cam !== undefined || v.share !== undefined, {
    message: 'at least one field required',
  });

function broadcastTo(rooms: ControlWorldRoom[], event: string, data: unknown): number {
  let delivered = 0;
  for (const room of rooms) {
    try {
      if (typeof room?.broadcast === 'function') {
        room.broadcast(event, data);
        delivered++;
      }
    } catch {}
  }
  return delivered;
}

export function registerControlRoutes(
  app: express.Application,
  requireAuth: (req: express.Request) => { userId: string; tenantId?: string } | null,
  requireApiToken: (req: express.Request) => Promise<{ userId: string } | null>,
) {
  // Remote controls (session or API token)
  app.post('/controls', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const parse = controlPayloadSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    if (!global.gameServer) return res.status(500).json({ error: 'game server not available' });

    const targets = resolveControlTargets(auth.userId);
    if ('error' in targets) return res.status(403).json({ error: targets.error });

    const delivered = broadcastTo(targets.rooms, 'remote_controls', { from: auth.userId, payload: parse.data });
    if (delivered === 0) return res.status(409).json({ error: 'no_active_targets' });
    res.json({ ok: true, delivered });
  });

  // Controls for a specific identity (session or API token)
  app.post('/controls/for/:identity', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const parse = controlPayloadSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    // Typed as `string | string[]` by the router; a single path segment can
    // never be an array, but the guard keeps the value a plain string instead
    // of casting it.
    const rawIdentity = req.params.identity;
    const identity = typeof rawIdentity === 'string' ? rawIdentity : '';
    if (!identity) return res.status(400).json({ error: 'identity required' });

    if (!global.gameServer) return res.status(500).json({ error: 'game server not available' });

    const targets = resolveControlTargets(auth.userId, identity);
    if ('error' in targets) return res.status(403).json({ error: targets.error });

    const delivered = broadcastTo(targets.rooms, 'remote_controls_for', {
      forIdentity: identity,
      from: auth.userId,
      payload: parse.data,
    });
    if (delivered === 0) return res.status(409).json({ error: 'no_active_targets' });
    res.json({ ok: true, delivered });
  });
}
