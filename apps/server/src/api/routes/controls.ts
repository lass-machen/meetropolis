import type express from 'express';
import { z } from 'zod';
import { isPlayerVisibleToTenant } from '../../rooms/lifecycle/tenantView.js';

/** A connected Colyseus client, as much of it as the delivery below needs. */
interface ControlClient {
  sessionId?: string;
  send?: (event: string, data: unknown) => void;
}

/** A seated player, as much of it as the authorization below needs. */
interface SeatedPlayer {
  identity?: string;
  isNpc?: boolean;
}

/** One seat in a room: who sits there, under which verified tenant. */
interface Seat {
  sessionId: string;
  isNpc: boolean;
  tenantKey: string | undefined;
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
 *
 * `clients` is the room's connected clients. Delivery goes through them one by
 * one instead of through `room.broadcast`, because a broadcast crosses exactly
 * the tenant boundary the authorization draws (see `deliverTo`).
 */
interface ControlWorldRoom {
  state?: {
    players?: { forEach?: (cb: (player: SeatedPlayer, sessionId: string) => void) => void };
  };
  playerTenantKey?: Map<string, string>;
  clients?: Iterable<ControlClient>;
}

/**
 * Every seat `identity` holds in `room` — plural, because one user can be
 * connected twice, and the two sessions can even carry different verified
 * tenants in a shared apex room.
 *
 * `state.players` is a Colyseus `MapSchema` keyed by sessionId; the user id
 * lives in `player.identity` (assigned in `rooms/lifecycle/onJoin.completion.ts`
 * from the verified join identity). Iterating with `forEach` matches how the
 * rest of the server reads that map (see `computeOnlineUsageByTenantSlug`).
 */
function findSeats(room: ControlWorldRoom, identity: string): Seat[] {
  const seats: Seat[] = [];
  try {
    room.state?.players?.forEach?.((player, sessionId) => {
      if (!player || player.identity !== identity) return;
      seats.push({ sessionId, isNpc: player.isNpc === true, tenantKey: room.playerTenantKey?.get(sessionId) });
    });
  } catch {}
  return seats;
}

/**
 * Every registered world room. Empty when the game server has not booted.
 *
 * The ambient type of `global.activeWorldRooms` is not the real
 * `rooms/WorldRoom.ts` class: `api/utils/broadcast.ts` declares the global with
 * a two-field stand-in of its own (`{ broadcast?, setDefaultSpawn? }`) and that
 * declaration shadows the richer shape in `types/global.d.ts`. Neither of the
 * two describes the room, so nothing may be inferred from either — hence the
 * cast here and the guard on every field read below.
 */
function listWorldRooms(): ControlWorldRoom[] {
  const activeWorldRooms = global.activeWorldRooms;
  if (!activeWorldRooms || activeWorldRooms.size === 0) return [];
  try {
    return Array.from(activeWorldRooms) as unknown as ControlWorldRoom[];
  } catch {
    return [];
  }
}

/**
 * One authorized delivery: the room, the caller's verified tenant key in it,
 * and — for a targeted control — the exact recipient sessionIds. `sessionIds`
 * of `undefined` means "every client of this room the caller may see", which is
 * what the untargeted route asks for.
 */
interface ControlTarget {
  room: ControlWorldRoom;
  callerKey: string;
  sessionIds?: Set<string>;
}

type ControlError = 'caller_not_in_a_world_room' | 'caller_tenant_unknown' | 'target_not_reachable';
type ControlTargets = { targets: ControlTarget[] } | { error: ControlError };

/**
 * Which clients may a control from `callerId` reach?
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
 * a caller may only reach a room it is seated in itself, only under a verified
 * tenant key (an unknown key fails closed), and a targeted control additionally
 * requires the target to be seated in that same room AND visible to the caller
 * under the room's tenant filter — the same predicate the state sync uses, so a
 * target the caller cannot even see cannot be controlled either. Of a target
 * with several sessions only the sessions that passed that check are addressed.
 *
 * Note what this does NOT decide: whether force-mute should be a moderator
 * privilege rather than something every participant may do to every other
 * participant. The button in `ui/user/card/ExpandedCard.tsx` is ungated for all
 * users, and answering that is a product decision, not a bug fix.
 */
function resolveControlTargets(callerId: string, targetId?: string): ControlTargets {
  const callerRooms: Array<{ room: ControlWorldRoom; callerKey: string | undefined }> = [];
  for (const room of listWorldRooms()) {
    const seats = findSeats(room, callerId);
    // A caller with two sessions in one room: the first seat carrying a
    // verified tenant key decides, so an unrelated key-less session cannot
    // downgrade an otherwise legitimate caller.
    if (seats.length > 0) {
      callerRooms.push({ room, callerKey: seats.find((s) => s.tenantKey !== undefined)?.tenantKey });
    }
  }
  if (callerRooms.length === 0) return { error: 'caller_not_in_a_world_room' };

  const known = callerRooms.filter(
    (entry): entry is { room: ControlWorldRoom; callerKey: string } => entry.callerKey !== undefined,
  );
  if (known.length === 0) return { error: 'caller_tenant_unknown' };

  if (targetId === undefined) return { targets: known.map(({ room, callerKey }) => ({ room, callerKey })) };

  const targets: ControlTarget[] = [];
  for (const { room, callerKey } of known) {
    const sessionIds = new Set(
      findSeats(room, targetId)
        .filter((seat) => isPlayerVisibleToTenant(seat.isNpc, seat.tenantKey, callerKey))
        .map((seat) => seat.sessionId),
    );
    if (sessionIds.size === 0) continue;
    targets.push({ room, callerKey, sessionIds });
  }
  if (targets.length === 0) return { error: 'target_not_reachable' };
  return { targets };
}

/**
 * Restrictive-only payload: these fan-out paths may only carry protective
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

/**
 * Send `event` to the authorized recipients and report how many clients got it.
 *
 * Deliberately NOT `room.broadcast`: a broadcast reaches every client of the
 * room instance, and one instance can hold several tenants (see
 * `ControlWorldRoom`). A room-wide send would therefore both act on foreign
 * tenants' devices (untargeted route) and hand them the caller's and the
 * target's user ids (targeted route) — identities the per-client `StateView`
 * filter otherwise withholds. `rooms/handlers/zoneLockHandler.ts` replaced its
 * broadcast with the same per-client loop for exactly that reason.
 *
 * A seat whose tenant key is unknown fails closed (not a recipient), and so
 * does a client the room does not track a seat for. The untargeted filter
 * passes `isNpc: false` on purpose: unlike the state sync, which shows NPCs to
 * everyone because they carry no PII, there is nothing to gain from sending a
 * device control to a bot, so NPC clients of a foreign tenant key are simply
 * skipped as well.
 */
function deliverTo(targets: ControlTarget[], event: string, data: unknown): number {
  let delivered = 0;
  for (const { room, callerKey, sessionIds } of targets) {
    const clients = room.clients;
    if (!clients) continue;
    try {
      for (const client of clients) {
        const sessionId = client?.sessionId;
        if (typeof sessionId !== 'string') continue;
        if (sessionIds && !sessionIds.has(sessionId)) continue;
        if (!sessionIds && !isPlayerVisibleToTenant(false, room.playerTenantKey?.get(sessionId), callerKey)) continue;
        if (typeof client.send !== 'function') continue;
        try {
          client.send(event, data);
          delivered++;
        } catch {}
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

    const delivered = deliverTo(targets.targets, 'remote_controls', { from: auth.userId, payload: parse.data });
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

    // `forIdentity` stays in the payload as a client-side safety net, but the
    // send list above already contains nothing but the target's own sessions.
    const delivered = deliverTo(targets.targets, 'remote_controls_for', {
      forIdentity: identity,
      from: auth.userId,
      payload: parse.data,
    });
    if (delivered === 0) return res.status(409).json({ error: 'no_active_targets' });
    res.json({ ok: true, delivered });
  });
}
