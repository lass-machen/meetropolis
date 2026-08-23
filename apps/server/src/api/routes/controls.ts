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
 * One authorized delivery: a room and the exact sessionIds inside it that may
 * receive the message. Both routes resolve to an explicit recipient list, so
 * there is no "everyone in this room" case left and `deliverTo` never has to
 * draw a boundary of its own.
 */
interface ControlTarget {
  room: ControlWorldRoom;
  sessionIds: Set<string>;
}

type ControlError = 'caller_not_in_a_world_room' | 'caller_tenant_unknown' | 'target_not_reachable';
type ControlTargets = { targets: ControlTarget[] } | { error: ControlError };

/** The verified caller behind a control request. */
interface ControlCaller {
  userId: string;
  /**
   * The tenant THIS REQUEST authenticated under. `requireAuth` reads it from
   * the session, i.e. from the same JWT claim the world join verifies into
   * `playerTenantKey` (see `api/utils/authHelpers.ts` and
   * `rooms/lifecycle/onAuth.ts`), so the two are comparable. Undefined for an
   * API token: `requireApiToken` resolves a user, never a tenant.
   */
  tenantId?: string | undefined;
}

/**
 * The caller's own sessions: every seat, in every room, that carries its user
 * id. This is the entire reach of the untargeted `POST /controls`.
 *
 * That route used to fan out over EVERY registered world room after checking
 * nothing but "is this request authenticated at all", so any logged-in user
 * could silence every participant of the whole deployment in one call. It is
 * now exactly what the API-token panel has always advertised: switch my own
 * devices off. Muting somebody else needs `/controls/for/:identity` below,
 * which names its target and is authorized against it.
 *
 * Deliberately NOT narrowed by tenant. A user seated under two verified tenants
 * owns both of those devices; the payload carries nothing but that same user's
 * id and the protective flags, and sender and recipient are the same person, so
 * there is no boundary here to cross. Reading a tenant off the seats would only
 * bring back the ambiguity `resolveCallerKey` exists to end, for no gain.
 *
 * NPC seats are skipped. An identity collision between a user and a bot is not
 * expected, and a device control has nothing to say to one either way.
 */
function resolveOwnSessions(callerId: string): ControlTargets {
  const targets: ControlTarget[] = [];
  for (const room of listWorldRooms()) {
    const sessionIds = new Set(
      findSeats(room, callerId)
        .filter((seat) => !seat.isNpc)
        .map((seat) => seat.sessionId),
    );
    if (sessionIds.size === 0) continue;
    targets.push({ room, sessionIds });
  }
  if (targets.length === 0) return { error: 'caller_not_in_a_world_room' };
  return { targets };
}

/**
 * The caller's verified tenant key inside ONE room, or undefined when it cannot
 * be established beyond doubt — in which case the caller is not authorized for
 * that room at all.
 *
 * One user can hold several seats in one room, and in a shared apex room those
 * seats can carry different verified tenants (see `ControlWorldRoom`). Taking
 * the first seat that happened to have a key let the iteration order decide
 * which tenant a control was issued under. The request's own tenant decides
 * instead; a seat under that key is the caller acting as itself, and a room
 * where it holds no such seat is simply not its room for this request.
 *
 * An API token carries no tenant, so there the seats have to answer alone and
 * only an unambiguous answer counts: exactly one distinct key. None, or more
 * than one, fails closed.
 */
function resolveCallerKey(seats: Seat[], requestTenantId: string | undefined): string | undefined {
  const keys = new Set<string>();
  for (const seat of seats) {
    if (seat.tenantKey !== undefined) keys.add(seat.tenantKey);
  }
  if (requestTenantId !== undefined) return keys.has(requestTenantId) ? requestTenantId : undefined;
  if (keys.size !== 1) return undefined;
  const [only] = keys;
  return only;
}

/**
 * Which clients may a targeted control from `caller` reach?
 *
 * This route used to check nothing but "is this request authenticated at all"
 * either: any logged-in user could mute any user of any tenant whose id they
 * knew, and an id is visible in the roster of every shared room. The
 * client-side filter is no defence — it only drops payloads not addressed to
 * itself (`realtime/handlers/remoteControlHandlers.ts`) and cannot judge
 * whether the sender had any authority.
 *
 * The rule enforced is the narrowest one that keeps the feature working: the
 * caller may only reach a room it is seated in itself, only under the verified
 * tenant key of this request, and the target must be seated in that same room
 * AND visible to the caller under the room's tenant filter — the same predicate
 * the state sync uses, so a target the caller cannot even see cannot be
 * controlled either. Of a target with several sessions only those that passed
 * that check are addressed.
 *
 * Note what this does NOT decide: whether force-mute should be a moderator
 * privilege rather than something every participant may do to every other
 * participant. The button in `ui/user/card/ExpandedCard.tsx` is ungated for all
 * users, and answering that is a product decision, not a bug fix.
 */
function resolveControlTargets(caller: ControlCaller, targetId: string): ControlTargets {
  const known: Array<{ room: ControlWorldRoom; callerKey: string }> = [];
  let seatedSomewhere = false;
  for (const room of listWorldRooms()) {
    const seats = findSeats(room, caller.userId);
    if (seats.length === 0) continue;
    seatedSomewhere = true;
    const callerKey = resolveCallerKey(seats, caller.tenantId);
    if (callerKey !== undefined) known.push({ room, callerKey });
  }
  if (!seatedSomewhere) return { error: 'caller_not_in_a_world_room' };
  if (known.length === 0) return { error: 'caller_tenant_unknown' };

  const targets: ControlTarget[] = [];
  for (const { room, callerKey } of known) {
    const sessionIds = new Set(
      findSeats(room, targetId)
        .filter((seat) => isPlayerVisibleToTenant(seat.isNpc, seat.tenantKey, callerKey))
        .map((seat) => seat.sessionId),
    );
    if (sessionIds.size === 0) continue;
    targets.push({ room, sessionIds });
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
 * tenants' devices and hand them the caller's and the target's user ids —
 * identities the per-client `StateView` filter otherwise withholds.
 * `rooms/handlers/zoneLockHandler.ts` replaced its broadcast with the same
 * per-client loop for exactly that reason.
 *
 * The recipient list is decided entirely above; this function adds no rule of
 * its own. A client not on the list is skipped, and a listed sessionId the room
 * has no client for simply receives nothing — that is a player still seated in
 * the state but already disconnected.
 */
function deliverTo(targets: ControlTarget[], event: string, data: unknown): number {
  let delivered = 0;
  for (const { room, sessionIds } of targets) {
    const clients = room.clients;
    if (!clients) continue;
    try {
      for (const client of clients) {
        const sessionId = client?.sessionId;
        if (typeof sessionId !== 'string') continue;
        if (!sessionIds.has(sessionId)) continue;
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
  // Own devices (session or API token). Reaches nothing but the caller's own
  // sessions — see resolveOwnSessions.
  app.post('/controls', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const parse = controlPayloadSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    if (!global.gameServer) return res.status(500).json({ error: 'game server not available' });

    const targets = resolveOwnSessions(auth.userId);
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

    // The tenant comes from the session, not from the seats: only the session
    // path has one, and only it is verified for THIS request (see ControlCaller).
    const caller: ControlCaller = { userId: auth.userId, tenantId: sessionAuth?.tenantId };
    const targets = resolveControlTargets(caller, identity);
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
