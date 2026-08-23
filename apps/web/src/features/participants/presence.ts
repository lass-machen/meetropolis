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
 *
 * Matching is by identity only. Until the H4 identity binding
 * (`rooms/lifecycle/onAuth.ts`, `ZONE_PRIVACY_AUTH_ENFORCE`) a client could
 * present an identity of its own choosing, so an online entry whose identity
 * was absent from the roster used to fall back to the roster row with the same
 * lowercased display name. The server now derives both keys from the same
 * verified subject — `/livekit/token` mints the token with `identity =
 * auth.userId` and `/presence/recent` lists membership user ids — so an online
 * human always meets their own row here, and the fallback could only ever fire
 * for an entry that is NOT that person: an NPC (identity `npc-*`, no
 * membership, visible to every tenant via `rooms/lifecycle/tenantView.ts`)
 * sharing a first name with a member would mark THAT member online and
 * overwrite their roster coordinates, which are the jump target of the roster
 * panel.
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

  // 3. Mark online users. Identity is the only key: an online entry that no
  //    roster row carries gets a row of its own, it never adopts somebody
  //    else's. See the note above the function for why the name fallback that
  //    used to sit here is gone.
  for (const [ident, v] of Object.entries(onlineByIdentity || {})) {
    const existing = map.get(ident);
    if (existing) {
      map.set(ident, { ...existing, name: v.name || existing.name, online: true, x: v.x, y: v.y });
      continue;
    }
    map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y });
  }

  return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
