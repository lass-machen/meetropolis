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
 * Merge server-side recent presence list with currently online map (from live session),
 * returning a roster list sorted by online first and then name.
 */
export function mergeRecentPresence(
  previous: RosterItem[],
  onlineByIdentity: Record<string, OnlineEntry>,
  apiData: ApiPresence[]
): RosterItem[] {
  const map = new Map<string, RosterItem>();
  const onlineCount = Object.keys(onlineByIdentity || {}).length;
  const shouldFlipOffline = onlineCount > 0;
  // Bewusstes Entprellen: Wenn die Online-Map leer ist (z. B. kurzzeitiger Disconnect),
  // behalten wir den bisherigen Online-Status bei, statt alles sofort auf offline zu setzen.
  for (const r of previous) {
    map.set(r.identity, shouldFlipOffline ? { ...r, online: false } : { ...r });
  }

  for (const p of apiData || []) {
    const ident = String(p.userId || (p.user && p.user.id) || '');
    const name = String((p.user && (p.user.name || p.user.email)) || ident);
    if (!ident) continue;
    const prev = map.get(ident);
    const base: RosterItem = prev || { identity: ident, name, online: false };
    const nextLastSeen = p.updatedAt ?? base.lastSeen;
    map.set(ident, {
      ...base,
      ...(nextLastSeen ? { lastSeen: nextLastSeen } : {}),
    });
  }

  for (const [ident, v] of Object.entries(onlineByIdentity)) {
    const prevItem = map.get(ident);
    if (prevItem) {
      map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y, ...(prevItem.lastSeen ? { lastSeen: prevItem.lastSeen } : {}) });
      continue;
    }
    // Name-based fallback: match by equal lowercased name if identity differs (legacy clients)
    let matchedKey: string | undefined;
    const vName = (v.name || '').trim().toLowerCase();
    for (const [k, item] of map.entries()) {
      const iName = (item.name || '').trim().toLowerCase();
      if (iName && vName && iName === vName) { matchedKey = k; break; }
    }
    if (matchedKey) {
      const cur = map.get(matchedKey)!;
      map.set(matchedKey, { ...cur, online: true, x: v.x, y: v.y });
    } else {
      map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
  );
}


