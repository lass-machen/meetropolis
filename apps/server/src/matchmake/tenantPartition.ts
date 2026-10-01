import { ServerError, matchMaker } from 'colyseus';
import type { PrismaClient } from '../generated/prisma/index.js';
import { assertAllowedMatchmakeMethod } from './allowedMethods.js';
import { logger } from '../logger.js';

/**
 * Format of a tenant slug used as the world-room partition key
 * (`options.tenant`, the Colyseus `filterBy(['tenant'])` key).
 *
 * The project has no single authoritative slug rule, so this one is the
 * superset of what its producers emit and accept:
 *  - enterprise public sign-up (`/^[a-z0-9-]+$/`, 2..64 characters),
 *  - the OSS `sanitizeSlug` alphabet for `X-Tenant` / `?tenant=` (`[a-z0-9_-]`),
 *  - the 64 character cap both enterprise tenant schemas apply.
 * It is deliberately NOT stricter than any of them, so a slug that any of
 * those paths can produce is never refused. Its job is to keep an anonymous
 * caller from smuggling arbitrary data (size, type, characters) into the room
 * partition key, which is used for room metadata, DB lookups and a presence
 * topic name.
 */
export const TENANT_SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** HTTP statuses Colyseus' matchmake route reports for these refusals. */
const BAD_REQUEST = 400;
const SERVICE_UNAVAILABLE = 503;

export function isValidTenantSlug(value: unknown): value is string {
  return typeof value === 'string' && TENANT_SLUG_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check the join options of a matchmake call BEFORE Colyseus looks for or
 * creates a room.
 *
 * Why here and not in `WorldRoom.onCreate`: Colyseus builds the room, runs
 * `__init()` (which starts a patch interval) and only then calls `onCreate`.
 * If `onCreate` throws, the half-built room is never disposed, so every refused
 * request would leak a timer-backed room. Refusing earlier costs nothing.
 *
 * A missing `tenant` key is accepted unchanged: shipping clients that omit it
 * (loadtest, a mobile session without a slug) keep their current behaviour.
 * An empty string is accepted too (see {@link resolveEmptyPartitionKey}).
 */
export function assertValidPartitionOptions(options: unknown): void {
  if (options === undefined) return;
  if (!isPlainObject(options)) {
    throw new ServerError(BAD_REQUEST, 'invalid_options');
  }
  // Same own-property test Colyseus applies when it builds the `filterBy` filter.
  if (!Object.prototype.hasOwnProperty.call(options, 'tenant')) return;
  const tenant = options.tenant;
  if (tenant === '' || isValidTenantSlug(tenant)) return;
  throw new ServerError(BAD_REQUEST, 'invalid_tenant');
}

/** Slug of the tenant a join without a usable partition key belongs to (see WorldRoom.onCreate). */
function defaultTenantSlug(): string {
  return process.env.DEFAULT_TENANT_SLUG || 'default';
}

/**
 * An empty `tenant` means "the default tenant": WorldRoom.onCreate files the
 * room it builds for it under that slug. Colyseus however looks rooms up by the
 * value the client sent, so an empty key never matched the room it had created
 * and every such request built a fresh room. Name the default tenant before the
 * lookup so these requests share its room like any other.
 */
export function resolveEmptyPartitionKey(options: unknown): unknown {
  if (!isPlainObject(options) || options.tenant !== '') return options;
  return { ...options, tenant: defaultTenantSlug() };
}

/** Whether a tenant with this slug exists. Rejecting is the caller's job. */
export type TenantExists = (slug: string) => Promise<boolean>;

/**
 * Tenant lookup backed by the `Tenant` table (`slug` is unique, so this is an
 * index lookup). Takes the client lazily because the one index.ts has at hand
 * is built when the API module loads, which happens after the validation is
 * installed.
 */
export function createTenantExistsLookup(getPrisma: () => PrismaClient): TenantExists {
  return async (slug) => {
    const row = await getPrisma().tenant.findUnique({ where: { slug }, select: { id: true } });
    return row !== null;
  };
}

/**
 * Refuse a well-formed but unknown tenant slug before a room is built for it.
 *
 * The format check alone leaves an anonymous caller an unbounded supply of
 * well-formed slugs, and every one of them builds a room (PrismaClient and pool,
 * timers, presence topic) that lives until its seat reservation expires. A slug
 * is accepted when
 *  - it is the default tenant (`DEFAULT_TENANT_SLUG`, else `default`). It is
 *    never looked up: it is the one slug an OSS install has, and its row is
 *    only created lazily by the first REST request, so a join must not depend
 *    on that. `joinOrCreate` callers share one room for it.
 *  - or a `Tenant` row with that slug exists (multi-tenant installs). An OSS
 *    install only ever has the default row, so there it is the only slug.
 * A missing `tenant` key is not checked: WorldRoom files it under the default
 * tenant. The lookup is not cached on purpose. A negative cache would fill up
 * with random slugs and a positive one would only add staleness; one indexed
 * query per matchmake is cheap at the per-IP rate limit.
 *
 * A lookup that fails (database down) refuses the request with a 503 instead of
 * letting it through: the join would fail on the same database moments later.
 */
export async function assertTenantExists(options: unknown, tenantExists: TenantExists): Promise<void> {
  if (!isPlainObject(options) || !Object.prototype.hasOwnProperty.call(options, 'tenant')) return;
  const slug = options.tenant;
  // The shape check normally ran before this; refuse rather than trust it.
  if (!isValidTenantSlug(slug)) throw new ServerError(BAD_REQUEST, 'invalid_tenant');
  if (slug === defaultTenantSlug()) return;
  let exists: boolean;
  try {
    exists = await tenantExists(slug);
  } catch (error) {
    logger.error({ event: 'matchmake.tenant_lookup_failed', error });
    throw new ServerError(SERVICE_UNAVAILABLE, 'tenant_lookup_failed');
  }
  if (!exists) throw new ServerError(BAD_REQUEST, 'invalid_tenant');
}

/**
 * Put the method and partition-key checks in front of every Colyseus matchmake
 * call. The HTTP route invokes `matchMaker.controller.invokeMethod` for all of
 * them, so this is the single choke point before any room is looked up or
 * created. Only the methods in `allowedMethods.ts` get past it.
 *
 * Returns a function that restores the unchecked method (tests start several
 * servers in one process; installing twice would otherwise nest the checks).
 */
export function installPartitionKeyValidation(
  tenantExists: TenantExists,
  controller: typeof matchMaker.controller = matchMaker.controller,
): () => void {
  const invoke = controller.invokeMethod.bind(controller);
  controller.invokeMethod = async (method, roomName, clientOptions, authOptions) => {
    assertAllowedMatchmakeMethod(method);
    assertValidPartitionOptions(clientOptions);
    const options = resolveEmptyPartitionKey(clientOptions);
    await assertTenantExists(options, tenantExists);
    const reservation: unknown = await invoke(method, roomName, options, authOptions);
    return reservation;
  };
  return () => {
    controller.invokeMethod = invoke;
  };
}
