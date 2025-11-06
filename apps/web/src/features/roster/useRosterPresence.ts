import * as React from 'react';
import { mergeRecentPresence } from '../participants/presence';

type Params = {
  apiBase: string;
  authChecked: boolean;
  meId?: string | null;
  rosterByIdentityRef: React.MutableRefObject<Record<string, { name: string; x: number; y: number }> >;
  setRoster: (updater: (prev: Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>) => Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>) => void;
};

export function useRosterPresence({ apiBase, authChecked, meId, rosterByIdentityRef, setRoster }: Params) {
  React.useEffect(() => {
    if (!authChecked || !meId) return;
    let stop = false as boolean;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/presence/recent`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const online = rosterByIdentityRef.current || {};
          setRoster((prev) => mergeRecentPresence(prev as any, online as any, data as any));
        }
      } catch {}
      if (!stop) setTimeout(load, 30000);
    };
    load();
    return () => { stop = true; };
  }, [apiBase, authChecked, meId]);
}


