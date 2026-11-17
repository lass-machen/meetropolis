/**
 * Shared hit counter for rate limiters.
 *
 * Budgets must apply across every server process, so hits live in Redis when
 * REDIS_URL is set. express-rate-limit forbids sharing one store instance
 * across limiters, so each call builds a new store with prefix `rl:${name}:`.
 * If Redis is unreachable the limiter keeps counting in process-local memory
 * instead of failing open or answering 500.
 */
import {
  MemoryStore,
  type ClientRateLimitInfo,
  type IncrementResponse,
  type Options,
  type Store,
} from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

import { logger } from '../../logger.js';
import { getSharedRedis } from '../../ops/redisConnection.js';

const PRIMARY_ERROR_LOG_INTERVAL_MS = 30_000;

class SharedRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private readonly primary: RedisStore;
  private readonly fallback = new MemoryStore();
  private readonly limiterName: string;
  private lastPrimaryErrorLogAt = 0;

  constructor(name: string, redis: Redis) {
    this.limiterName = name;
    this.prefix = `rl:${name}:`;
    this.primary = new RedisStore({
      prefix: this.prefix,
      // rate-limit-redis 6 sends one object { key, isReadOnly, command }.
      sendCommandCluster: ({ command }) => redis.call(command[0] ?? '', ...command.slice(1)) as Promise<RedisReply>,
    });
  }

  async init(options: Options): Promise<void> {
    this.fallback.init(options);
    try {
      await this.primary.init(options);
    } catch (error) {
      this.logPrimaryError(error);
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.primary.increment(key);
    } catch (error) {
      this.logPrimaryError(error);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.primary.decrement(key);
    } catch (error) {
      this.logPrimaryError(error);
    }
    await this.fallback.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.primary.resetKey(key);
    } catch (error) {
      this.logPrimaryError(error);
    }
    await this.fallback.resetKey(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      return await this.primary.get(key);
    } catch (error) {
      this.logPrimaryError(error);
      return this.fallback.get(key);
    }
  }

  private logPrimaryError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastPrimaryErrorLogAt < PRIMARY_ERROR_LOG_INTERVAL_MS) return;
    this.lastPrimaryErrorLogAt = now;
    logger.error({ event: 'rate_limit.redis_store_error', limiter: this.limiterName, err: error });
  }
}

export function createSharedRateLimitStore(name: string): Store | undefined {
  const redis = getSharedRedis();
  if (redis === undefined) return undefined;
  return new SharedRateLimitStore(name, redis);
}
