/**
 * Budget for the websocket upgrade path.
 *
 * Every upgrade attempt is counted before the origin check, so a client that
 * hammers the handshake path runs into a budget instead of into the origin
 * policy. The counter lives in the memory store of express-rate-limit: it
 * expires on its own and holds nothing but a hit count and a reset time.
 *
 * The client address is resolved with the semantics the HTTP surface gives
 * `req.ip`: the `trust proxy` setting decides how much of the forwarded chain
 * is believed (see trustProxy.ts). There is no loopback exemption and no
 * debug switch: the mobile gateway, which joins from inside the server
 * process, and the npc-service, which runs in its own container, share the
 * budget of their source address. A deployment that needs more raises
 * WS_UPGRADE_RATE_LIMIT_MAX.
 *
 * Nothing about an attempt is logged: no address, no URL, no header and no
 * query value.
 */

import express from 'express';
import type { IncomingMessage } from 'node:http';
import { MemoryStore, ipKeyGenerator, type Options } from 'express-rate-limit';
import { resolveTrustProxySetting } from '../trustProxy.js';

/** Environment key that holds the upgrade attempts one address may start per window. */
export const WS_UPGRADE_LIMIT_MAX_KEY = 'WS_UPGRADE_RATE_LIMIT_MAX';

/** Environment key that holds the length of the upgrade window in milliseconds. */
export const WS_UPGRADE_LIMIT_WINDOW_KEY = 'WS_UPGRADE_RATE_LIMIT_WINDOW_MS';

/** The default budget: 120 attempts per minute and address. */
const DEFAULT_MAX = 120;

/** The default window: one minute. */
const DEFAULT_WINDOW_MS = 60_000;

/** The shortest window a deployment may configure. */
const MIN_WINDOW_MS = 1_000;

/** The longest window a deployment may configure. */
const MAX_WINDOW_MS = 3_600_000;

/** The largest budget a deployment may configure. */
const MAX_MAX = 100_000;

/** Plain decimal integers without a sign; everything else is a configuration error. */
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

export interface WsUpgradeLimitSettings {
  /** The upgrade attempts one client address may start per window. */
  readonly max: number;
  /** The length of the window in milliseconds. */
  readonly windowMs: number;
}

export interface WsUpgradeAllowed {
  readonly allowed: true;
}

export interface WsUpgradeDenied {
  readonly allowed: false;
  /** The seconds the client has to wait until the budget is available again. */
  readonly retryAfterSeconds: number;
}

export type WsUpgradeDecision = WsUpgradeAllowed | WsUpgradeDenied;

export interface WsUpgradeLimiter {
  /** Count one upgrade attempt and decide whether it may proceed. */
  checkWsUpgrade(req: IncomingMessage): Promise<WsUpgradeDecision>;
}

/**
 * Read the upgrade budget from the environment. A missing or empty value takes
 * the default; a value that is set but is not a plain decimal integer inside
 * the allowed range is a configuration error, because a budget nobody can
 * predict is worse than no budget at all. The error names the key, never the
 * value.
 */
export function resolveWsUpgradeLimit(env: NodeJS.ProcessEnv): WsUpgradeLimitSettings {
  return {
    max: readSetting(env, WS_UPGRADE_LIMIT_MAX_KEY, DEFAULT_MAX, 1, MAX_MAX),
    windowMs: readSetting(env, WS_UPGRADE_LIMIT_WINDOW_KEY, DEFAULT_WINDOW_MS, MIN_WINDOW_MS, MAX_WINDOW_MS),
  };
}

function readSetting(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  lowerBound: number,
  upperBound: number,
): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return fallback;
  if (!POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} must be a decimal integer without a sign`);
  }
  const value = Number(raw);
  if (value < lowerBound || value > upperBound) {
    throw new Error(`${key} must be between ${lowerBound} and ${upperBound}`);
  }
  return value;
}

/**
 * Build the limiter that counts the upgrade attempts of one server process.
 *
 * The trust proxy setting is the one the HTTP surface uses; the caller passes
 * it so both surfaces resolve the very same value.
 */
export function createWsUpgradeLimiter(
  settings: WsUpgradeLimitSettings,
  trustProxy: boolean | number = resolveTrustProxySetting(),
): WsUpgradeLimiter {
  const store = new MemoryStore();
  // The store reads nothing but the window length; the rest of the options
  // belong to the rate limit middleware, not to the store. The cast stays
  // inside this one call.
  store.init({ windowMs: settings.windowMs } as Partial<Options> as Options);
  const resolveAddress = createAddressResolver(trustProxy);

  return {
    async checkWsUpgrade(req: IncomingMessage): Promise<WsUpgradeDecision> {
      const address = resolveAddress(req) ?? req.socket?.remoteAddress;
      if (address === undefined || address === '') {
        // Without an address there is no key to count under. The attempt is
        // refused instead of going uncounted.
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(settings.windowMs / 1000)) };
      }
      const { totalHits, resetTime } = await store.increment(ipKeyGenerator(address));
      if (totalHits <= settings.max) return { allowed: true };
      return { allowed: false, retryAfterSeconds: secondsUntilReset(resetTime) };
    },
  };
}

/**
 * Resolve the client address of an upgrade with the semantics Express gives
 * `req.ip`. The resolver is an Express application that never answers a
 * request; it only provides the request prototype the address getter needs.
 */
function createAddressResolver(trustProxy: boolean | number): (req: IncomingMessage) => string | undefined {
  const resolver = express();
  resolver.set('trust proxy', trustProxy);
  return (req: IncomingMessage): string | undefined => {
    // The view carries what Express reads to resolve an address: the headers
    // and the socket. It inherits from the prototype of the resolver app, so
    // the address getter and the app wide trust setting apply.
    const view = Object.create(resolver.request) as express.Request;
    view.headers = req.headers;
    view.socket = req.socket;
    view.connection = req.connection;
    const address = view.ip;
    return address !== undefined && address !== '' ? address : undefined;
  };
}

/** The seconds until the counter resets, rounded up and never below one. */
function secondsUntilReset(resetTime: Date | undefined): number {
  if (resetTime === undefined) return 1;
  const remainingMs = resetTime.getTime() - Date.now();
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
