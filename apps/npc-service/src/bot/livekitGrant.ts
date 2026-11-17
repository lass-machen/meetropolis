import type { VideoGrant } from 'livekit-server-sdk';

// Set every grant explicitly: unset grants default to allowed on the server,
// so leaving out canPublishData would still let this participant publish data.
// canSubscribe must be true: the Rust SDK's wait_pc_connection() waits for
// the subscriber PeerConnection to reach "connected" state. With canSubscribe: false,
// the server never sends a subscriber offer, causing a 15s timeout.
export function npcVideoGrant(roomName: string): VideoGrant {
  return {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  };
}
