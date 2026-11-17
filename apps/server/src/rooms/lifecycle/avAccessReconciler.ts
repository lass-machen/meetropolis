import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import { logger } from '../../logger.js';
import { hasTenantAccess } from '../../api/utils/tenantMembership.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { TRANSCRIBER_IDENTITY } from '../audioZones/islandAttributes.js';
import { mapLivekitUrlToHttp } from '../audioZones/livekitAdmin.js';
import { avSessionRefMatches, readAvSessionRef } from './avSessionRef.js';
import { enqueueAvRevocation, ensureAvPendingRevocations } from './avPendingRevocations.js';

const RECONCILE_INTERVAL_MS = 30_000;
const LIST_CONCURRENCY = 4;
const NPC_PREFIX = 'npc-';
const WORLD_SUBROOM = 'world';

type ReconcilerPrisma = Pick<PrismaClient, 'tenant' | 'session' | 'membership' | 'npc'>;

export interface AvAccessReconciler {
  runRound(): Promise<void>;
  stop(): Promise<void>;
}

interface NpcCheck {
  roomName: string;
  identity: string;
  tenantId: string;
  record: string;
}

interface UserCheck {
  roomName: string;
  identity: string;
  tenantId: string;
  ref: string;
}

interface RoundRemoval {
  roomName: string;
  identity: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tenant slug from `<slug>:world`; every other room name is out of scope. */
function parseWorldSlug(roomName: string): string | null {
  const at = roomName.lastIndexOf(':');
  if (at <= 0 || roomName.slice(at + 1) !== WORLD_SUBROOM) return null;
  return roomName.slice(0, at);
}

/** Admin client for reconciliation rounds: 5 s request timeout. */
function createReconcileClient(): RoomServiceClient | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const rawUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !rawUrl) return null;
  return new RoomServiceClient(mapLivekitUrlToHttp(rawUrl), apiKey, apiSecret, { requestTimeout: 5 });
}

function collectWorldRooms(rooms: Array<{ name: string }>): Map<string, string> {
  const found = new Map<string, string>();
  for (const room of rooms) {
    const slug = parseWorldSlug(room.name);
    if (slug !== null) found.set(room.name, slug);
  }
  return found;
}

async function resolveTenantIds(prisma: ReconcilerPrisma, slugs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(slugs)];
  const rows = await prisma.tenant.findMany({ where: { slug: { in: unique } }, select: { id: true, slug: true } });
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/** At most four participant listings at once; a failed room is skipped this round. */
async function listParticipantsBounded(
  client: RoomServiceClient,
  roomNames: string[],
): Promise<Map<string, ParticipantInfo[]>> {
  const found = new Map<string, ParticipantInfo[]>();
  for (let at = 0; at < roomNames.length; at += LIST_CONCURRENCY) {
    const batch = roomNames.slice(at, at + LIST_CONCURRENCY);
    const listed = await Promise.all(
      batch.map(async (roomName) => {
        try {
          return await client.listParticipants(roomName);
        } catch (error: unknown) {
          logger.warn({ event: 'av.reconcile_list_failed', error: errorText(error) });
          return null;
        }
      }),
    );
    batch.forEach((roomName, index) => {
      const participants = listed[index];
      if (participants) found.set(roomName, participants);
    });
  }
  return found;
}

function classifyParticipants(
  roomParticipants: Map<string, ParticipantInfo[]>,
  worldSlugs: Map<string, string>,
  tenantBySlug: Map<string, string>,
): { npcChecks: NpcCheck[]; userChecks: UserCheck[]; removals: RoundRemoval[]; total: number } {
  const npcChecks: NpcCheck[] = [];
  const userChecks: UserCheck[] = [];
  const removals: RoundRemoval[] = [];
  let total = 0;
  for (const [roomName, participants] of roomParticipants) {
    const slug = worldSlugs.get(roomName);
    if (!slug) continue;
    const tenantId = tenantBySlug.get(slug);
    for (const participant of participants) {
      total += 1;
      const identity = participant.identity;
      if (identity === TRANSCRIBER_IDENTITY) continue;
      if (identity.startsWith(NPC_PREFIX)) {
        if (!tenantId) removals.push({ roomName, identity });
        else npcChecks.push({ roomName, identity, tenantId, record: identity.slice(NPC_PREFIX.length) });
        continue;
      }
      if (!tenantId) {
        removals.push({ roomName, identity });
        continue;
      }
      const ref = readAvSessionRef(participant.metadata);
      if (ref === null) removals.push({ roomName, identity });
      else userChecks.push({ roomName, identity, tenantId, ref });
    }
  }
  return { npcChecks, userChecks, removals, total };
}

/** NPC checks without an exact tenant plus record pair; one bundled query. */
async function unknownNpcs(prisma: ReconcilerPrisma, checks: NpcCheck[]): Promise<RoundRemoval[]> {
  if (checks.length === 0) return [];
  const rows = await prisma.npc.findMany({
    where: {
      tenantId: { in: [...new Set(checks.map((check) => check.tenantId))] },
      identity: { in: [...new Set(checks.map((check) => check.record))] },
    },
    select: { tenantId: true, identity: true },
  });
  const valid = new Set(rows.map((row) => JSON.stringify([row.tenantId, row.identity])));
  return checks
    .filter((check) => !valid.has(JSON.stringify([check.tenantId, check.record])))
    .map((check) => ({ roomName: check.roomName, identity: check.identity }));
}

/**
 * User checks whose reference matches no live session of the same subject;
 * all sessions load in one query, matching is local. Throws on database
 * errors so the round aborts without removing anyone.
 */
async function withoutLiveSession(
  prisma: ReconcilerPrisma,
  checks: UserCheck[],
): Promise<{ matched: UserCheck[]; removals: RoundRemoval[] }> {
  if (checks.length === 0) return { matched: [], removals: [] };
  const now = new Date();
  const rows = await prisma.session.findMany({
    where: { userId: { in: [...new Set(checks.map((check) => check.identity))] }, expiresAt: { gt: now } },
    select: { id: true, userId: true },
  });
  const byUser = new Map<string, string[]>();
  for (const row of rows) {
    const known = byUser.get(row.userId);
    if (known) known.push(row.id);
    else byUser.set(row.userId, [row.id]);
  }
  const matched: UserCheck[] = [];
  const removals: RoundRemoval[] = [];
  for (const check of checks) {
    const sessions = byUser.get(check.identity) ?? [];
    if (sessions.some((sessionId) => avSessionRefMatches(check.ref, sessionId))) matched.push(check);
    else removals.push({ roomName: check.roomName, identity: check.identity });
  }
  return { matched, removals };
}

/** Matched checks without current tenant access; throws so the round aborts. */
async function withoutTenantAccess(prisma: ReconcilerPrisma, checks: UserCheck[]): Promise<RoundRemoval[]> {
  const grants = await Promise.all(checks.map((check) => hasTenantAccess(prisma, check.identity, check.tenantId)));
  return checks
    .filter((_, index) => !grants[index])
    .map((check) => ({ roomName: check.roomName, identity: check.identity }));
}

async function runReconcileRound(prisma: ReconcilerPrisma): Promise<void> {
  const started = Date.now();
  const client = createReconcileClient();
  if (!client) {
    logger.debug({ event: 'av.reconcile_skipped', reason: 'not_configured' });
    return;
  }
  let rooms: Array<{ name: string }>;
  try {
    rooms = await client.listRooms();
  } catch (error: unknown) {
    logger.warn({ event: 'av.reconcile_list_failed', error: errorText(error) });
    return;
  }
  const worldSlugs = collectWorldRooms(rooms);
  if (worldSlugs.size === 0) {
    logger.info({ event: 'av.reconcile_round', rooms: 0, participants: 0, removals: 0, durationMs: 0 });
    return;
  }
  try {
    const tenantBySlug = await resolveTenantIds(prisma, [...worldSlugs.values()]);
    const roomParticipants = await listParticipantsBounded(client, [...worldSlugs.keys()]);
    const classified = classifyParticipants(roomParticipants, worldSlugs, tenantBySlug);
    const removals = [...classified.removals];
    removals.push(...(await unknownNpcs(prisma, classified.npcChecks)));
    const { matched, removals: sessionRemovals } = await withoutLiveSession(prisma, classified.userChecks);
    removals.push(...sessionRemovals);
    removals.push(...(await withoutTenantAccess(prisma, matched)));
    for (const removal of removals) enqueueAvRevocation(removal.roomName, removal.identity);
    logger.info({
      event: 'av.reconcile_round',
      rooms: worldSlugs.size,
      participants: classified.total,
      removals: removals.length,
      durationMs: Date.now() - started,
    });
  } catch (error: unknown) {
    logger.warn({ event: 'av.reconcile_aborted', error: errorText(error) });
  }
}

/**
 * Periodic tenant-call reconciliation: every 30 s exactly one round lists
 * every `<slug>:world` room and removes participants without a live,
 * session-bound grant through the confirmed backlog. Database errors abort
 * the round and remove nothing. No positive cache, no switches.
 */
export function startAvAccessReconciler(prisma: ReconcilerPrisma): AvAccessReconciler {
  ensureAvPendingRevocations();
  let current: Promise<void> | null = null;
  const runRound = (): Promise<void> => {
    if (current) return current;
    current = runReconcileRound(prisma).finally(() => {
      current = null;
    });
    return current;
  };
  const timer = setInterval(() => {
    runRound().catch(() => {
      /* logged inside the round */
    });
  }, RECONCILE_INTERVAL_MS);
  timer.unref();
  return {
    runRound,
    stop: async () => {
      clearInterval(timer);
      if (current) await current;
    },
  };
}
