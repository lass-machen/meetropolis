export function getDisplayName(
  identity: string,
  nameMap: Record<string, string>,
  me?: { id: string; email?: string; name?: string } | null,
): string {
  if (!identity) return '';
  if (nameMap[identity]) return nameMap[identity];
  if (me && (identity === me.id || identity === me.email)) {
    return me.name || me.email || me.id;
  }
  if (identity.length > 20 && /^[a-zA-Z0-9]+$/.test(identity)) {
    return `User ${identity.substring(0, 6)}`;
  }
  return identity;
}
