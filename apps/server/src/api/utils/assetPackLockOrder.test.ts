/**
 * Contract test: pack locks use a stable order and deduplicate keys.
 * `acquirePackAdvisoryLocks` sorts pack UUIDs so reversed or duplicate inputs
 * produce the same lock sequence on the SQL client. Covers helper ordering only
 * — not a DB race proof.
 */
import { describe, it, expect, vi } from 'vitest';
import { acquirePackAdvisoryLocks } from './advisoryLocks.js';
import type { MapDb } from './mapChunkMutations.js';

interface SqlDouble {
  values: unknown[];
}

function makeTx(): { tx: MapDb; seen: string[] } {
  const seen: string[] = [];
  const tx = {
    $queryRaw: vi.fn((query: SqlDouble) => {
      seen.push(String(query.values[0]));
      return Promise.resolve([]);
    }),
  } as unknown as MapDb;
  return { tx, seen };
}

describe('acquirePackAdvisoryLocks order', () => {
  it('locks reversed and duplicated pack ids in the same stable order without duplicates', async () => {
    const forward = makeTx();
    await acquirePackAdvisoryLocks(forward.tx, ['pack-a', 'pack-b', 'pack-c']);

    const shuffled = makeTx();
    await acquirePackAdvisoryLocks(shuffled.tx, ['pack-c', 'pack-a', 'pack-b', 'pack-a', 'pack-c']);

    expect(shuffled.seen).toEqual(forward.seen);
    expect(shuffled.seen).toEqual([
      'meetropolis:asset-pack:pack-a',
      'meetropolis:asset-pack:pack-b',
      'meetropolis:asset-pack:pack-c',
    ]);
  });
});
