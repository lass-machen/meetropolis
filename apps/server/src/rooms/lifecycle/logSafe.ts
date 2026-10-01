/**
 * Log-safe renderings of client-supplied join values.
 *
 * Join options come off the wire unvalidated, and `WorldRoom.onAuth` runs
 * before any authentication, so an anonymous client decides their length and
 * even their type. A log line must not grow with what the client sent, so
 * every client-supplied value on the join path goes through one of these
 * helpers before it reaches the logger.
 */

/** Longest stretch of a client-supplied string that may reach a log line. */
export const MAX_LOGGED_CLIENT_STRING = 64;

/**
 * A client-supplied string in a form that is safe to log. A long string is cut
 * and says how long it was, anything that is not a string is reduced to its
 * type.
 */
export function clientStringForLog(value: unknown): string {
  if (typeof value !== 'string') return `<${typeof value}>`;
  if (value.length <= MAX_LOGGED_CLIENT_STRING) return value;
  return `${value.slice(0, MAX_LOGGED_CLIENT_STRING)}... (${value.length} chars)`;
}

/** A client-supplied number for a log line: the value if it is a finite number, else its type. */
export function clientNumberForLog(value: unknown): number | string {
  return typeof value === 'number' && Number.isFinite(value) ? value : `<${typeof value}>`;
}
