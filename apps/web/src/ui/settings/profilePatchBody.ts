/**
 * The body of PATCH /me. The server rejects a blank name with `invalid name`,
 * and an account without a name is legitimate (sign-up without one, guests), so
 * a name is only sent when there is one: a blank field leaves the stored name
 * as it is and the e-mail address can still be changed on its own.
 */
export function profilePatchBody(name: string, email: string): { name?: string; email: string } {
  const trimmedName = name.trim();
  return trimmedName ? { name: trimmedName, email } : { email };
}
