import { create } from 'zustand';

export interface ZoneLockPendingRequest {
  sessionId: string;
  identity: string;
  name: string;
}

export interface ZoneLockInfo {
  zoneName: string;
  mapId: string;
  lockedBy: string;
  accessList: string[];
  pendingRequests: ZoneLockPendingRequest[];
}

interface ZoneLockStore {
  locks: ZoneLockInfo[];
  setLocks: (locks: ZoneLockInfo[]) => void;
  getLock: (zoneName: string) => ZoneLockInfo | undefined;
  isLocked: (zoneName: string) => boolean;
  hasAccess: (zoneName: string, sessionId: string) => boolean;
}

export const useZoneLockStore = create<ZoneLockStore>((set, get) => ({
  locks: [],
  setLocks: (locks) => set({ locks }),
  getLock: (zoneName) => get().locks.find((l) => l.zoneName === zoneName),
  isLocked: (zoneName) => get().locks.some((l) => l.zoneName === zoneName),
  hasAccess: (zoneName, sessionId) => {
    const lock = get().locks.find((l) => l.zoneName === zoneName);
    if (!lock) return true; // not locked = everyone has access
    return lock.accessList.includes(sessionId);
  },
}));
