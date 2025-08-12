import { createLocalTracks, createLocalScreenTracks, Room } from 'livekit-client';

export async function joinLivekitRoom(params: {
  baseUrl: string;
  tokenEndpoint: string;
  roomName: string;
  identity: string;
  useVideo: boolean;
}) {
  const res = await fetch(`${params.baseUrl}/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: params.roomName, identity: params.identity })
  });
  const token = (await res.text()).trim();
  const room = new Room();
  await room.connect(import.meta.env.VITE_LIVEKIT_URL, token);
  const tracks = await createLocalTracks({ audio: true, video: params.useVideo });
  for (const t of tracks) await room.localParticipant.publishTrack(t);
  return room;
}

export async function startScreenshare(room: Room) {
  const tracks = await createLocalScreenTracks({});
  for (const t of tracks) await room.localParticipant.publishTrack(t);
}
