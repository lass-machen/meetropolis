import { Prisma } from '../../generated/prisma/index.js';
import type { MapDb } from './mapChunkMutations.js';

async function acquireAdvisoryLock(tx: MapDb, key: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`);
}

/**
 * Global advisory-lock order:
 *
 * 1. all map locks, sorted by map id;
 * 2. all asset-pack locks, sorted by pack UUID.
 *
 * A transaction that needs both kinds must never acquire a map lock after a
 * pack lock. This keeps map snapshots and immutable pack snapshots serialized
 * without introducing a lock-order cycle.
 */
export async function acquireMapAdvisoryLock(tx: MapDb, mapId: string): Promise<void> {
  await acquireAdvisoryLock(tx, `meetropolis:map:${mapId}`);
}

export async function acquireMapAdvisoryLocks(tx: MapDb, mapIds: Iterable<string>): Promise<void> {
  const sorted = [...new Set(mapIds)].sort();
  for (const mapId of sorted) await acquireMapAdvisoryLock(tx, mapId);
}

/**
 * Serializes pack replacement/deletion with creation of immutable map
 * snapshots. This transaction-scoped lock establishes the current invariant
 * without a filesystem generation model. Versioned generations plus
 * reference-aware garbage collection remain the more sustainable design.
 */
export async function acquirePackAdvisoryLock(tx: MapDb, packUuid: string): Promise<void> {
  await acquireAdvisoryLock(tx, `meetropolis:asset-pack:${packUuid}`);
}

export async function acquirePackAdvisoryLocks(tx: MapDb, packUuids: Iterable<string>): Promise<void> {
  const sorted = [...new Set(packUuids)].sort();
  for (const packUuid of sorted) await acquirePackAdvisoryLock(tx, packUuid);
}
