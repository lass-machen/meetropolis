import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';
import { z } from 'zod';

/**
 * The display name limit is shared with the web client, which puts it on its
 * name fields, and with the world join, which clamps a name to it on its way
 * into the room state (rooms/lifecycle/joinFields.ts).
 */
export { MAX_DISPLAY_NAME_LENGTH };

/**
 * A user's display name as a route accepts it: surrounding whitespace is
 * dropped first, and what is left must be 1 to MAX_DISPLAY_NAME_LENGTH
 * characters. Parsing yields the trimmed value that is stored.
 */
export const displayNameSchema = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);

/** The 400 body for a rejected name; `details` carries the zod issues, as other routes' `invalid body` does. */
export function invalidNameBody(details: z.ZodError['issues']): {
  error: 'invalid name';
  details: z.ZodError['issues'];
} {
  return { error: 'invalid name', details };
}

/**
 * The 400 body when a failed parse of a request object was about its `name`
 * field, or null when the failure is about another field. A route calls this
 * first so a rejected name is reported as one, and falls back to its own
 * message for everything else.
 */
export function invalidNameBodyFor(error: z.ZodError): { error: 'invalid name'; details: z.ZodError['issues'] } | null {
  const details = error.issues.filter((issue) => issue.path[0] === 'name');
  return details.length > 0 ? invalidNameBody(details) : null;
}
