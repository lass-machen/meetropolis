/**
 * Shared Redis connection for multi-process operation.
 *
 * Without `REDIS_URL` the server runs as a single process exactly as
 * before and no Redis client is created. With `REDIS_URL` processes
 * share presence, the room registry and counters through Redis, using
 * one client per process.
 */
import { Redis } from 'ioredis';

import { logger } from '../logger.js';

let sharedRedis: Redis | undefined;

/** Read `REDIS_URL` from the environment; a missing or blank value means single-process mode. */
export function readRedisUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.REDIS_URL?.trim();
  return url ? url : undefined;
}

/** Whether the environment configures multi-process operation via Redis. */
export function isMultiProcessMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return readRedisUrl(env) !== undefined;
}

/**
 * Return the process-wide shared Redis client, creating it on first use.
 * Without `REDIS_URL` this returns `undefined` and creates nothing.
 */
export function getSharedRedis(): Redis | undefined {
  if (sharedRedis) return sharedRedis;
  const url = readRedisUrl();
  if (!url) return undefined;
  const client = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  let lastErrorLoggedAt = 0;
  client.on('error', (error) => {
    const now = Date.now();
    if (now - lastErrorLoggedAt < 30_000) return;
    lastErrorLoggedAt = now;
    logger.error({ event: 'redis.shared_connection_error', err: error });
  });
  sharedRedis = client;
  return sharedRedis;
}

/**
 * Close the shared Redis client and reset the singleton; without a client
 * this is a no-op. A ready client quits gracefully; a client that never
 * became ready disconnects instead, so closing cannot wait for a reply
 * that will never arrive.
 */
export async function closeSharedRedis(): Promise<void> {
  const client = sharedRedis;
  sharedRedis = undefined;
  if (!client) return;
  if (client.status === 'ready') {
    await client.quit();
  } else {
    client.disconnect();
  }
}
