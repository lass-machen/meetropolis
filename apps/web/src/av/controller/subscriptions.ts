export type DesiredSubscription = { identity: string; audio?: boolean; video?: boolean };

export type SubscriptionInputs = {
  activeRoomName: string | null;
  myRoomName: string | null;
  bubbleMembers: string[];
  zoneMembers: string[];
  activeSpeakers: string[];
  maxVideo: number;
};

// Platzhalter-Implementation – wird in nachfolgenden Schritten ausgefüllt
export function buildDesiredSubscriptions(_inputs: SubscriptionInputs): Set<DesiredSubscription> {
  return new Set();
}


