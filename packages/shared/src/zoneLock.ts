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
