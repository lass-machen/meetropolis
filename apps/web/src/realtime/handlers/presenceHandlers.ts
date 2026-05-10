import { mergeRecentPresence, type ApiPresence, type RosterItem } from '../../features/participants/presence';
import type { UseWorldRoomArgs } from '../types';
import type { WorldRoom } from '../../types/colyseus';

export function setupPresenceHandlers(
  room: WorldRoom,
  args: UseWorldRoomArgs,
  recentPresenceRef: { current: ApiPresence[] },
) {
  const { rosterByIdentityRef, setRoster } = args;

  // Presence: Seed der letzten Aktivitäten (ohne Polling)
  room.onMessage('presence_recent', (list: ApiPresence[]) => {
    try {
      recentPresenceRef.current = Array.isArray(list) ? list : [];
      setRoster((prev) => mergeRecentPresence(prev, rosterByIdentityRef.current, recentPresenceRef.current));
    } catch {}
  });

  // Presence: Einzel-Update (z. B. Positions-/Zeitstempelaktualisierung)
  room.onMessage('presence_update', (p: ApiPresence) => {
    try {
      const list = Array.isArray(recentPresenceRef.current) ? [...recentPresenceRef.current] : [];
      const idx = list.findIndex((x) => String(x.userId) === String(p?.userId));
      if (idx >= 0) list[idx] = { ...list[idx], ...p, updatedAt: p.updatedAt || new Date().toISOString() };
      else list.push({ ...p, updatedAt: p.updatedAt || new Date().toISOString() });
      recentPresenceRef.current = list;
      setRoster((prev) => mergeRecentPresence(prev, rosterByIdentityRef.current, recentPresenceRef.current));
    } catch {}
  });
}

interface OnlineEntry {
  name: string;
  x: number;
  y: number;
}

export function createRosterRefresher(args: UseWorldRoomArgs) {
  const { remotesRef, colyseusToLivekitMap, identityToNameMap, me, localPosRef, rosterByIdentityRef, setRoster } = args;

  return () => {
    try {
      const online: Record<string, OnlineEntry> = {};
      // Remotes (Colyseus SIDs -> LiveKit Identity)
      for (const [sid, pos] of Object.entries(remotesRef.current)) {
        const livekitIdentity = colyseusToLivekitMap.current[sid] || sid;
        const name = identityToNameMap.current[livekitIdentity] || livekitIdentity;
        online[livekitIdentity] = { name, x: pos.x, y: pos.y };
      }
      // Local (stabile User-ID)
      try {
        if (me?.id) {
          const lp = localPosRef.current;
          online[me.id] = { name: me.name || me.email || me.id, x: lp?.x ?? 0, y: lp?.y ?? 0 };
        }
      } catch {}
      rosterByIdentityRef.current = online;
      setRoster((prev) => {
        const map = new Map<string, RosterItem>();
        for (const r of prev) map.set(r.identity, { ...r, online: false });
        for (const [ident, v] of Object.entries(online)) {
          if (map.has(ident)) {
            const cur = map.get(ident);
            if (cur) {
              map.set(ident, {
                ...cur,
                name: v.name,
                online: true,
                x: v.x,
                y: v.y,
              });
            }
          } else {
            // Fallback: match by display name to avoid duplicates when identities diverge
            let matchedKey: string | undefined;
            for (const [k, val] of map.entries()) {
              if ((val.name || '').toLowerCase() === (v.name || '').toLowerCase()) {
                matchedKey = k;
                break;
              }
            }
            if (matchedKey) {
              const cur = map.get(matchedKey);
              if (cur) {
                map.set(matchedKey, { ...cur, online: true, x: v.x, y: v.y });
              }
            } else {
              map.set(ident, {
                identity: ident,
                name: v.name,
                online: true,
                x: v.x,
                y: v.y,
              });
            }
          }
        }
        return Array.from(map.values()).sort(
          (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
        );
      });
    } catch {}
  };
}
