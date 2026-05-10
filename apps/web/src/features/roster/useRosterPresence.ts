import * as React from 'react';
import { mergeRecentPresence } from '../participants/presence';

type Params = {
  apiBase: string;
  authChecked: boolean;
  meId?: string | null;
  rosterByIdentityRef: React.MutableRefObject<Record<string, { name: string; x: number; y: number }>>;
  setRoster: (
    updater: (
      prev: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>,
    ) => Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>,
  ) => void;
  avRef?: React.MutableRefObject<any>;
};

/**
 * useRosterPresence - Loads all tenant members via HTTP and merges with live online state.
 *
 * Data flow:
 * 1. HTTP-Fetch on mount: Loads ALL tenant members from /presence/recent
 * 2. WebSocket updates: Online/offline changes propagated via presence_recent/presence_update
 * 3. LiveKit presence: Used to determine current online status
 *
 * The HTTP-Fetch is the primary data source for the complete member list.
 * WS is only for real-time updates to online/offline status.
 */
export function useRosterPresence({ apiBase, authChecked, meId, rosterByIdentityRef, setRoster, avRef }: Params) {
  const initialFetchDoneRef = React.useRef(false);

  // Fetch all tenant members on mount
  React.useEffect(() => {
    if (!authChecked || !meId) return;
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;

    const loadAllMembers = async () => {
      try {
        const res = await fetch(`${apiBase}/presence/recent`, { credentials: 'include' });
        if (!res.ok) return;

        const data = await res.json();

        // Build online map from Colyseus state + LiveKit
        const online = { ...(rosterByIdentityRef.current || {}) } as Record<
          string,
          { name: string; x: number; y: number }
        >;

        // Add LiveKit participants to online map
        try {
          const room: any = avRef?.current?.room;
          if (room) {
            const addParticipant = (p: any) => {
              if (!p) return;
              const identity = p.identity || p.sid;
              const name = p.name || identity;
              if (identity && !online[identity]) {
                online[identity] = { name, x: 0, y: 0 };
              }
            };
            addParticipant(room.localParticipant);
            const remotes = Array.from(room.remoteParticipants?.values?.() || []);
            for (const rp of remotes) addParticipant(rp);
          }
        } catch {}

        setRoster((prev) => mergeRecentPresence(prev, online, data));
      } catch {}
    };

    void loadAllMembers();
  }, [apiBase, authChecked, meId, rosterByIdentityRef, setRoster, avRef]);
}
