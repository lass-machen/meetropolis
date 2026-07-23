import { logger } from '../lib/logger';
import { getApiBaseFromWindow } from '../lib/runtimeConfig';
import { useMapStore } from '../state/mapStore';
import { computeBackoffDelayMs } from '../lib/backoff';

export interface TilesetRegistrationRequest {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
}

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const MAX_ATTEMPTS_PER_TILESET = 5;

const queue: TilesetRegistrationRequest[] = [];
// Keys that are queued or waiting for a scheduled retry. Prevents duplicate
// server registrations when a registration run is re-triggered while the
// previous run is still in flight.
const pendingKeys = new Set<string>();
// Successful registrations, keyed per map: a re-triggered registration run
// (e.g. after a join retry) must not repeat already-completed POSTs.
const registeredMapKeys = new Set<string>();
const attemptsByMapKey = new Map<string, number>();
let processing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let missingMapAttempts = 0;
// Map the queued entries belong to. Payloads (dataUrl, tile metrics) come
// from one specific map's editor load; after a map switch they are stale
// and must not be registered against the new map.
let activeMapId: string | null = null;

function mapKeyOf(mapId: string, tilesetKey: string): string {
  return `${mapId}:${tilesetKey}`;
}

function syncActiveMap(mapId: string | null): void {
  if (!mapId) return;
  if (activeMapId !== null && activeMapId !== mapId) {
    queue.length = 0;
    pendingKeys.clear();
  }
  activeMapId = mapId;
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processQueue();
  }, delayMs);
}

async function postRegistration(mapId: string, ts: TilesetRegistrationRequest): Promise<boolean> {
  const base = getApiBaseFromWindow();
  try {
    const res = await fetch(`${base}/maps/${encodeURIComponent(mapId)}/tilesets`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: ts.key,
        imageUrl: ts.dataUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        margin: ts.margin,
        spacing: ts.spacing,
      }),
    });
    if (!res.ok) {
      logger.warn(`[TilesetQueue] Tileset registration failed: ${res.status} for key="${ts.key}"`);
      return false;
    }
    await res.json();
    logger.debug(`[TilesetQueue] Tileset "${ts.key}" registered successfully`);
    return true;
  } catch (e) {
    logger.error('[TilesetQueue] Failed to register tileset on server', e);
    return false;
  }
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const mapId = useMapStore.getState().currentMapId;
      if (!mapId) {
        // The map id resolves asynchronously on boot; keep the queue and
        // retry later instead of dropping the registrations. The attempt
        // counter only grows when a new timer is actually armed — every
        // enqueue re-triggers processQueue and must not inflate the backoff.
        if (!retryTimer) {
          missingMapAttempts += 1;
          scheduleRetry(
            computeBackoffDelayMs(missingMapAttempts, {
              baseDelayMs: RETRY_BASE_DELAY_MS,
              maxDelayMs: RETRY_MAX_DELAY_MS,
            }),
          );
        }
        return;
      }
      missingMapAttempts = 0;
      syncActiveMap(mapId);
      if (queue.length === 0) break;

      const ts = queue.shift();
      if (!ts) continue;
      const mapKey = mapKeyOf(mapId, ts.key);
      if (registeredMapKeys.has(mapKey)) {
        pendingKeys.delete(ts.key);
        continue;
      }
      const previousAttempts = attemptsByMapKey.get(mapKey) ?? 0;
      if (previousAttempts >= MAX_ATTEMPTS_PER_TILESET) {
        logger.debug(`[TilesetQueue] Skipping tileset "${ts.key}": retry budget exhausted`);
        pendingKeys.delete(ts.key);
        continue;
      }

      const ok = await postRegistration(mapId, ts);
      if (ok) {
        registeredMapKeys.add(mapKey);
        attemptsByMapKey.delete(mapKey);
        pendingKeys.delete(ts.key);
        continue;
      }

      const attempts = previousAttempts + 1;
      attemptsByMapKey.set(mapKey, attempts);
      if (attempts >= MAX_ATTEMPTS_PER_TILESET) {
        logger.error(`[TilesetQueue] Giving up on tileset "${ts.key}" after ${attempts} attempts`);
        pendingKeys.delete(ts.key);
        continue;
      }
      // A failed POST usually means the server or the map is unavailable;
      // pause the whole queue instead of bursting through the remaining
      // registrations. The failed entry moves to the back so other tilesets
      // are not starved once processing resumes.
      queue.push(ts);
      scheduleRetry(
        computeBackoffDelayMs(attempts, {
          baseDelayMs: RETRY_BASE_DELAY_MS,
          maxDelayMs: RETRY_MAX_DELAY_MS,
        }),
      );
      return;
    }
  } finally {
    processing = false;
  }
}

export function enqueueTilesetRegistration(ts: TilesetRegistrationRequest): void {
  const mapId = useMapStore.getState().currentMapId;
  // Invalidate stale entries from a previous map before deduplicating,
  // otherwise their pending keys would swallow the new map's registrations.
  syncActiveMap(mapId);
  if (mapId && registeredMapKeys.has(mapKeyOf(mapId, ts.key))) return;
  if (pendingKeys.has(ts.key)) return;
  pendingKeys.add(ts.key);
  queue.push(ts);
  void processQueue();
}

/** Test-only: clears all module state including scheduled timers. */
export function resetTilesetRegistrationQueueForTests(): void {
  queue.length = 0;
  pendingKeys.clear();
  registeredMapKeys.clear();
  attemptsByMapKey.clear();
  missingMapAttempts = 0;
  processing = false;
  activeMapId = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
