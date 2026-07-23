export type OnlineEntry = { name: string; x: number; y: number };

export type RosterItem = {
  identity: string;
  name: string;
  online: boolean;
  x?: number;
  y?: number;
  lastSeen?: string;
};

export type ApiPresence = {
  userId: string;
  user?: { id?: string; email?: string; name?: string } | null;
  x?: number;
  y?: number;
  updatedAt?: string;
};

/**
 * Merge the server-side recent presence list with the currently online map
 * (from the live session) and return a roster sorted by online first, then
 * by name.
 *
 * Logic:
 * 1. All API users start as offline with lastSeen.
 * 2. Users that are online in the live session are marked online.
 */
export function mergeRecentPresence(
  previous: RosterItem[],
  onlineByIdentity: Record<string, OnlineEntry>,
  apiData: ApiPresence[],
): RosterItem[] {
  const map = new Map<string, RosterItem>();

  // 1. Insert every API user as offline first.
  for (const p of apiData || []) {
    const ident = String(p.userId || (p.user && p.user.id) || '');
    const name = String((p.user && (p.user.name || p.user.email)) || ident);
    if (!ident) continue;
    const item: RosterItem = {
      identity: ident,
      name,
      online: false,
    };
    if (p.updatedAt) item.lastSeen = p.updatedAt;
    map.set(ident, item);
  }

  // 2. Carry over previous entries for users not yet returned by the API.
  for (const r of previous) {
    if (!map.has(r.identity)) {
      map.set(r.identity, { ...r, online: false });
    }
  }

  // 3. Mark online users.
  for (const [ident, v] of Object.entries(onlineByIdentity || {})) {
    const existing = map.get(ident);
    if (existing) {
      map.set(ident, { ...existing, name: v.name || existing.name, online: true, x: v.x, y: v.y });
      continue;
    }
    // Name-based fallback: match by equal lowercased name if identity differs (legacy clients)
    let matchedKey: string | undefined;
    const vName = (v.name || '').trim().toLowerCase();
    for (const [k, item] of map.entries()) {
      const iName = (item.name || '').trim().toLowerCase();
      if (iName && vName && iName === vName) {
        matchedKey = k;
        break;
      }
    }
    if (matchedKey) {
      const cur = map.get(matchedKey)!;
      map.set(matchedKey, { ...cur, online: true, x: v.x, y: v.y });
    } else {
      map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y });
    }
  }

  return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
