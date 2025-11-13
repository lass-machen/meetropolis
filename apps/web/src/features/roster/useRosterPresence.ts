import * as React from 'react';
import { mergeRecentPresence } from '../participants/presence';

type Params = {
  apiBase: string;
  authChecked: boolean;
  meId?: string | null;
  rosterByIdentityRef: React.MutableRefObject<Record<string, { name: string; x: number; y: number }> >;
  setRoster: (updater: (prev: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>) => Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>) => void;
  // Optional: LiveKit-Fallback, um Online-Status ohne World-WS zu erhalten
  avRef?: React.MutableRefObject<any>;
  enablePoll?: boolean;
};

export function useRosterPresence({ apiBase, authChecked, meId, rosterByIdentityRef, setRoster, avRef, enablePoll = true }: Params) {
  React.useEffect(() => {
    if (!authChecked || !meId) return;
    if (!enablePoll) return;
    let stop = false as boolean;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/presence/recent`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          // Online-Map aus World-WS (rosterByIdentityRef)
          const online = { ...(rosterByIdentityRef.current || {}) } as Record<string, { name: string; x: number; y: number }>;
          // Fallback: LiveKit-Teilnehmer als "online" markieren, falls WS offline ist
          try {
            const room: any = avRef?.current?.room;
            if (room && (room.localParticipant || room.remoteParticipants)) {
              const add = (p: any) => {
                if (!p) return;
                const identity = p.identity || p.sid;
                const name = p.name || identity;
                if (identity && !online[identity]) {
                  online[identity] = { name, x: 0, y: 0 };
                }
              };
              add(room.localParticipant);
              const remotes = Array.from((room.remoteParticipants?.values?.() || room.participants?.values?.() || []) as any);
              for (const rp of remotes) add(rp);
            }
          } catch {}
          setRoster((prev) => mergeRecentPresence(prev as any, online as any, data as any));
        }
      } catch {}
      if (!stop) setTimeout(load, 30000);
    };
    load();
    return () => { stop = true; };
  }, [apiBase, authChecked, meId, enablePoll]);
}


