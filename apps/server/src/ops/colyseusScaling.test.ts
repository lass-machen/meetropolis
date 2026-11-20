/**
 * Tests for the Colyseus scaling options.
 *
 * The environment is always passed in as an object, so `process.env`
 * is never changed. Every presence and driver created here is shut
 * down after the test, so no connection to the unreachable test
 * address stays open.
 */
import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { afterEach, describe, expect, it } from 'vitest';

import { createColyseusScalingOptions } from './colyseusScaling.js';

type ScalingOptions = ReturnType<typeof createColyseusScalingOptions>;

const created: ScalingOptions[] = [];

function create(env: NodeJS.ProcessEnv): ScalingOptions {
  const options = createColyseusScalingOptions(env);
  created.push(options);
  return options;
}

afterEach(async () => {
  for (const options of created.splice(0)) {
    await options.driver?.shutdown();
    options.presence?.shutdown();
  }
});

describe('createColyseusScalingOptions', () => {
  it('returns an empty object without keys when REDIS_URL is missing', () => {
    const options = create({});
    expect(options).toEqual({});
    expect(Object.keys(options)).toHaveLength(0);
  });

  it('returns an empty object when REDIS_URL is blank', () => {
    const options = create({ REDIS_URL: '   ' });
    expect(options).toEqual({});
    expect(Object.keys(options)).toHaveLength(0);
  });

  it('creates a Redis presence and driver when REDIS_URL is set', () => {
    const options = create({
      REDIS_URL: 'redis://127.0.0.1:1',
      COLYSEUS_PUBLIC_ADDRESS: 'api.example.org/p1',
    });
    expect(options.presence).toBeInstanceOf(RedisPresence);
    expect(options.driver).toBeInstanceOf(RedisDriver);
    expect(options.publicAddress).toBe('api.example.org/p1');
  });

  it('omits publicAddress when COLYSEUS_PUBLIC_ADDRESS is missing', () => {
    const options = create({ REDIS_URL: 'redis://127.0.0.1:1' });
    expect(options.presence).toBeInstanceOf(RedisPresence);
    expect(options.driver).toBeInstanceOf(RedisDriver);
    expect(options.publicAddress).toBeUndefined();
    expect('publicAddress' in options).toBe(false);
  });

  it('omits publicAddress when COLYSEUS_PUBLIC_ADDRESS is blank', () => {
    const options = create({
      REDIS_URL: 'redis://127.0.0.1:1',
      COLYSEUS_PUBLIC_ADDRESS: '   ',
    });
    expect(options.publicAddress).toBeUndefined();
    expect('publicAddress' in options).toBe(false);
  });
});
