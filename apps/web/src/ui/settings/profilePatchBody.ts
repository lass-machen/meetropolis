/** Saving a name does not request an email change. Preserve blank names. */
export function profilePatchBody(name: string, _email?: string): { name?: string } {
  const trimmed = name.trim();
  return trimmed ? { name: trimmed } : {};
}
