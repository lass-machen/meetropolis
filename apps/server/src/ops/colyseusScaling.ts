/**
 * Colyseus scaling options for multi-process operation.
 *
 * Without `REDIS_URL` this returns an empty object and Colyseus runs in
 * a single process exactly as before. With `REDIS_URL` all processes
 * share presence, the room registry and counters through Redis.
 * `COLYSEUS_PUBLIC_ADDRESS` is the public address of exactly this
 * process (host plus path, without protocol); seat reservation routes
 * the WebSocket connection to that address.
 */
import type { MatchMakerDriver, Presence } from '@colyseus/core';
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';

import { readRedisUrl } from './redisConnection.js';

/** Build the Colyseus scaling options for the given environment. */
export function createColyseusScalingOptions(env: NodeJS.ProcessEnv = process.env): {
  presence?: Presence;
  driver?: MatchMakerDriver;
  publicAddress?: string;
} {
  const url = readRedisUrl(env);
  if (!url) return {};
  const options: { presence?: Presence; driver?: MatchMakerDriver; publicAddress?: string } = {
    presence: new RedisPresence(url),
    driver: new RedisDriver(url),
  };
  const publicAddress = env.COLYSEUS_PUBLIC_ADDRESS?.trim();
  if (publicAddress) options.publicAddress = publicAddress;
  return options;
}
