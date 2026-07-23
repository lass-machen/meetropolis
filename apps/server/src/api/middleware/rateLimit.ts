import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../logger.js';

/**
 * Central, env-configurable rate limiting for the public, unauthenticated
 * auth / sign-up surface.
 *
 * Why: `/auth/login`, `/auth/register`, the password-reset and e-mail
 * verification flows, guest magic-link redemption and the enterprise
 * `/public/tenants` sign-up are all reachable without a session and are the
 * classic targets for credential/token brute-force, account or e-mail
 * flooding and expensive-write abuse. This module provides one factory plus a
 * set of pre-configured limiters that the route registrars mount in front of
 * the individual handlers.
 *
 * Keying: we rely on express-rate-limit's default key generator, which keys by
 * client IP (`req.ip`) and is IPv6-subnet aware. That makes the limiter only
 * as trustworthy as `req.ip`, which in turn depends on the app-wide
 * `trust proxy` setting (see index.ts / TRUST_PROXY in .env.example): behind a
 * reverse proxy it MUST be the number of proxy hops so `req.ip` resolves to the
 * real, non-spoofable client IP rather than the proxy or a client-supplied
 * `X-Forwarded-For` value.
 *
 * Store: the default in-process MemoryStore. It is per-process, which is
 * correct for the current single-instance server deployment. If the server is
 * ever scaled horizontally, swap in a shared store (e.g. Redis) so the budget
 * is enforced across replicas.
 */

const MINUTE_MS = 60_000;

/**
 * Global kill-switch. Rate limiting is on by default; set
 * `RATE_LIMIT_ENABLED=false` (also accepts `0` / `off`) to turn every limiter
 * built through {@link createRateLimiter} into a pass-through. Intended for
 * local debugging and load tests, not for production.
 */
function rateLimitingEnabled(): boolean {
  const raw = (process.env.RATE_LIMIT_ENABLED ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/**
 * Read a positive integer from the environment, falling back to `fallback`
 * when the variable is unset, empty or not a valid positive integer. Invalid
 * values are logged and ignored rather than crashing boot, so a fat-fingered
 * override never takes the server down.
 */
function readPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn({ event: 'rate_limit.invalid_env', envKey, value: raw, fallback });
    return fallback;
  }
  return parsed;
}

export interface RateLimiterConfig {
  /**
   * Stable identifier used both for log context and to derive the env override
   * keys `RATE_LIMIT_<NAME>_WINDOW_MS` / `RATE_LIMIT_<NAME>_MAX`
   * (upper-cased), e.g. `login` -> `RATE_LIMIT_LOGIN_MAX`.
   */
  name: string;
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Maximum number of requests per key (client IP) within the window. */
  limit: number;
  /**
   * When true, only failed responses (HTTP status >= 400) count toward the
   * limit. Used for login so a legitimate user who eventually authenticates is
   * never locked out, while a credential brute-force (all 4xx) is still capped.
   */
  skipSuccessfulRequests?: boolean;
  /**
   * Overrides the default per-IP keying. Only for limiters that must budget by
   * something the request carries in its body (see {@link forgotPasswordEmailRateLimiter}).
   * Must fall back to `ipKeyGenerator(req.ip)` — never a raw `req.ip` — when the
   * value is absent, so IPv6 clients are keyed by subnet rather than by address.
   */
  keyGenerator?: (req: Request) => string;
}

const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * Build a rate limiter for the public auth surface. Window and limit default
 * to the passed config but can be overridden per deployment via
 * `RATE_LIMIT_<NAME>_WINDOW_MS` and `RATE_LIMIT_<NAME>_MAX`.
 *
 * The 429 response is delegated to the central error handler (via `next` with
 * an {@link AppError}) so the body matches every other API error
 * (`{ success: false, error: { code, message } }`). express-rate-limit has
 * already set the standardized `RateLimit-*` and `Retry-After` headers on the
 * response by the time the handler runs.
 */
export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  if (!rateLimitingEnabled()) return passthrough;

  const envPrefix = `RATE_LIMIT_${config.name.toUpperCase()}`;
  const windowMs = readPositiveInt(`${envPrefix}_WINDOW_MS`, config.windowMs);
  const limit = readPositiveInt(`${envPrefix}_MAX`, config.limit);

  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    ...(config.keyGenerator && { keyGenerator: config.keyGenerator }),
    // Standardized RateLimit-Limit/Remaining/Reset headers (IETF draft-6);
    // the legacy X-RateLimit-* set is intentionally disabled.
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, _res, next) => {
      logger.warn({
        event: 'rate_limit.exceeded',
        limiter: config.name,
        ip: req.ip,
        method: req.method,
        path: req.path,
      });
      next(AppError.tooManyRequests('Too many requests. Please wait a moment and try again.', 'RATE_LIMITED'));
    },
  });
}

/**
 * Failed-login throttle for `POST /auth/login`. Only failed attempts count
 * (`skipSuccessfulRequests`), so brute-force is capped without penalising a
 * user who logs in correctly.
 */
export const loginRateLimiter = createRateLimiter({
  name: 'login',
  windowMs: 15 * MINUTE_MS,
  limit: 10,
  skipSuccessfulRequests: true,
});

/**
 * Account registration for `POST /auth/register` (invite-code redemption).
 * Curbs invite-code guessing and automated account creation.
 */
export const registrationRateLimiter = createRateLimiter({
  name: 'register',
  windowMs: 60 * MINUTE_MS,
  limit: 10,
});

/**
 * Password-reset flow (`POST /auth/forgot`, `POST /auth/reset`). Curbs
 * reset-token brute-force and e-mail enumeration on the forgot endpoint.
 */
export const passwordResetRateLimiter = createRateLimiter({
  name: 'password_reset',
  windowMs: 15 * MINUTE_MS,
  limit: 10,
});

/**
 * Per-ADDRESS budget for `POST /auth/forgot`, mounted in addition to the
 * per-IP {@link passwordResetRateLimiter}.
 *
 * Since /auth/forgot mails a real reset link, the per-IP limit alone leaves two
 * gaps: it lets one IP request links for 10 different victims per window, and a
 * distributed caller can flood a single known mailbox from many IPs — a cheap
 * way to bury the victim in mail, or to keep invalidating the link they are
 * trying to use (issuing a token drops the previous one). Keying by the
 * requested address closes both regardless of origin.
 *
 * 3 per hour: a real user needs one, plus a retry when the first mail is slow
 * or lands in spam. Anything beyond that is not a person trying to log in.
 * Deliberately budgeted per raw address as sent — normalising here (stripping
 * plus-tags) would let one budget cover unrelated accounts.
 */
export const forgotPasswordEmailRateLimiter = createRateLimiter({
  name: 'forgot_password_email',
  windowMs: 60 * MINUTE_MS,
  limit: 3,
  keyGenerator: (req) => {
    const email = readEmailFromBody(req);
    // No/!string email: the handler rejects it as a 400 anyway. Fall back to
    // the IP budget so a malformed flood cannot dodge accounting entirely.
    return email ? `email:${email}` : ipKeyGenerator(req.ip ?? '');
  },
});

/** Lower-cased `body.email`, or null when absent/not a string. */
function readEmailFromBody(req: Request): string | null {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object') return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' && email.length > 0 ? email.trim().toLowerCase() : null;
}

/**
 * E-mail verification flow (`POST /auth/verify`, `POST /auth/verify/request`).
 * Curbs verification-token brute-force and verification-mail flooding, on top
 * of the per-user cooldown the request handler already enforces.
 */
export const emailVerificationRateLimiter = createRateLimiter({
  name: 'email_verification',
  windowMs: 15 * MINUTE_MS,
  limit: 10,
});

/**
 * Guest magic-link redemption (`POST /auth/guest`). Curbs guest-token
 * brute-force.
 */
export const guestLoginRateLimiter = createRateLimiter({
  name: 'guest_login',
  windowMs: 15 * MINUTE_MS,
  limit: 20,
});

/**
 * Public tenant sign-up (enterprise `POST /public/tenants`) — the most
 * expensive public write (creates a tenant plus its owner). Strictest budget.
 */
export const tenantSignupRateLimiter = createRateLimiter({
  name: 'tenant_signup',
  windowMs: 60 * MINUTE_MS,
  limit: 5,
});

/**
 * Character-editor compositing (`POST /me/avatar/compose`). Authenticated, but
 * each call runs 8-state sprite compositing + PNG encode + disk writes, so it
 * is throttled per IP to prevent an authenticated user filling the disk /
 * burning CPU with rapid re-saves.
 */
export const avatarComposeRateLimiter = createRateLimiter({
  name: 'avatar_compose',
  windowMs: MINUTE_MS,
  limit: 20,
});

/**
 * Avatar-manifest lookup (`POST /avatars/resolve`). Authenticated and
 * read-only (a single indexed `uuid IN (...)` query), and the web client
 * already batches up to 100 ids per call, de-dupes in-flight requests and
 * negative-caches misses for 30s — so this is a backstop against a scripted
 * client hammering the endpoint directly, not the primary defense. Set well
 * above `avatar_compose` (which does real CPU/disk work) to absorb a normal
 * burst of resolve calls (loading a full world, switching rooms, a reconnect
 * that drops the in-memory manifest cache), including from several browser
 * tabs behind the same IP.
 *
 * Caveat: like every limiter here, this is keyed per IP (see module docs
 * above). Multiple users behind the same NAT/corporate-proxy IP share one
 * budget, so a busy office bursting into a full room could approach this
 * limit collectively. That is accepted here because the query itself is
 * cheap and capped in size (see `ResolveSchema` in meAvatar.ts) — a shared
 * false-positive throttle is preferable to leaving the endpoint unbounded.
 */
export const avatarResolveRateLimiter = createRateLimiter({
  name: 'avatar_resolve',
  windowMs: MINUTE_MS,
  limit: 60,
});
