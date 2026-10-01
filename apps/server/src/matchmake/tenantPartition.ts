import { ServerError, matchMaker } from 'colyseus';

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

/** HTTP status Colyseus' matchmake route reports for these refusals. */
const BAD_REQUEST = 400;

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
 * An empty string is accepted too and means "the default tenant".
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

/**
 * Put the partition-key check in front of every Colyseus matchmake call
 * (`joinOrCreate`, `create`, `join`, `joinById`, `reconnect`). The HTTP route
 * invokes `matchMaker.controller.invokeMethod` for all of them, so this is the
 * single choke point before any room is looked up or created.
 */
export function installPartitionKeyValidation(controller: typeof matchMaker.controller = matchMaker.controller): void {
  const invoke = controller.invokeMethod.bind(controller);
  controller.invokeMethod = async (method, roomName, clientOptions, authOptions) => {
    assertValidPartitionOptions(clientOptions);
    const reservation: unknown = await invoke(method, roomName, clientOptions, authOptions);
    return reservation;
  };
}
