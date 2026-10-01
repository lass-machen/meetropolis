import { MAX_DISPLAY_NAME_LENGTH } from '@meetropolis/shared';

/**
 * The register form has a first and a last name field, and the account's
 * display name is the two joined by one space. The limits of the fields add up
 * with that space to MAX_DISPLAY_NAME_LENGTH, so the joined name can never be
 * longer than the server accepts, whatever is typed into either field.
 */
export const FIRST_NAME_MAX_LENGTH = Math.ceil((MAX_DISPLAY_NAME_LENGTH - 1) / 2);
export const LAST_NAME_MAX_LENGTH = MAX_DISPLAY_NAME_LENGTH - 1 - FIRST_NAME_MAX_LENGTH;

/** First and last name joined into the display name; blank parts are dropped. */
export function composeRegisterName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}
