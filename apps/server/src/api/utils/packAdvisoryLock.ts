import { Prisma } from '../../generated/prisma/index.js';
import type { MapDb } from './mapChunkMutations.js';

/**
 * Serializes pack replacement/deletion with creation of immutable map
 * snapshots. This transaction-scoped lock establishes the current invariant
 * without a filesystem generation model. Versioned generations plus
 * reference-aware garbage collection remain the more sustainable design.
 */
export async function acquirePackAdvisoryLock(tx: MapDb, packUuid: string): Promise<void> {
  const key = `meetropolis:asset-pack:${packUuid}`;
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function acquirePackAdvisoryLocks(tx: MapDb, packUuids: Iterable<string>): Promise<void> {
  const sorted = [...new Set(packUuids)].sort();
  for (const packUuid of sorted) await acquirePackAdvisoryLock(tx, packUuid);
}
