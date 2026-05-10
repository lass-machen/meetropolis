import { mergeRecentPresence, type ApiPresence } from '../../features/participants/presence';
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
      const idx = list.findIndex((x) => String(x.userId) === String((p as any)?.userId));
      if (idx >= 0) list[idx] = { ...list[idx], ...p, updatedAt: p.updatedAt || new Date().toISOString() };
      else list.push({ ...p, updatedAt: p.updatedAt || new Date().toISOString() });
      recentPresenceRef.current = list;
      setRoster((prev) => mergeRecentPresence(prev, rosterByIdentityRef.current, recentPresenceRef.current));
    } catch {}
  });
}

export function createRosterRefresher(args: UseWorldRoomArgs) {
  const { remotesRef, colyseusToLivekitMap, identityToNameMap, me, localPosRef, rosterByIdentityRef, setRoster } = args;

  return () => {
    try {
      const online: Record<string, { name: string; x: number; y: number }> = {};
      // Remotes (Colyseus SIDs -> LiveKit Identity)
      for (const [sid, pos] of Object.entries(remotesRef.current)) {
        const livekitIdentity = (colyseusToLivekitMap.current as any)[sid] || sid;
        const name = identityToNameMap.current[livekitIdentity] || livekitIdentity;
        online[livekitIdentity] = { name, x: (pos as any).x, y: (pos as any).y };
      }
      // Local (stabile User-ID)
      try {
        if (me?.id) {
          const lp = localPosRef.current as any;
          online[me.id] = { name: me.name || me.email || me.id, x: lp?.x ?? 0, y: lp?.y ?? 0 };
        }
      } catch {}
      rosterByIdentityRef.current = online;
      setRoster((prev) => {
        const map = new Map<
          string,
          { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }
        >();
        for (const r of prev) map.set(r.identity, { ...r, online: false });
        for (const [ident, v] of Object.entries(online)) {
          if (map.has(ident)) {
            map.set(ident, {
              ...(map.get(ident) as any),
              name: (v as any).name,
              online: true,
              x: (v as any).x,
              y: (v as any).y,
            });
          } else {
            // Fallback: match by display name to avoid duplicates when identities diverge
            let matchedKey: string | undefined;
            for (const [k, val] of map.entries()) {
              if ((val.name || '').toLowerCase() === ((v as any).name || '').toLowerCase()) {
                matchedKey = k;
                break;
              }
            }
            if (matchedKey) {
              const cur = map.get(matchedKey)!;
              map.set(matchedKey, { ...cur, online: true, x: (v as any).x, y: (v as any).y });
            } else {
              map.set(ident, {
                identity: ident,
                name: (v as any).name,
                online: true,
                x: (v as any).x,
                y: (v as any).y,
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
