import { connect, Room } from 'livekit-client';
import { AccessToken } from 'livekit-server-sdk';

export async function spawnLivekitBot(opts: { apiBase: string; livekitUrl: string; roomName: string; identity: string }) {
  // Generate server-side token
  const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';
  const at = new AccessToken(apiKey, apiSecret, { identity: opts.identity } as any);
  at.addGrant({ room: opts.roomName, roomJoin: true, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  const room: Room = await connect(opts.livekitUrl, token, {
    autoSubscribe: false,
    // @ts-ignore
    adaptiveStream: true,
    // @ts-ignore
    dynacast: true,
    // @ts-ignore
    publishDefaults: { dtx: true }
  } as any);

  // Publish silence audio
  try {
    const { createLocalTracks } = await import('livekit-client');
    const tracks = await createLocalTracks({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } as any
    } as any);
    for (const t of tracks) {
      if ((t as any).kind === 'audio') {
        try { await room.localParticipant.publishTrack(t); } catch {}
      }
    }
  } catch {}

  let alive = true;
  // Periodically subscribe to a few participants (simulate proximity)
  (async () => {
    while (alive) {
      try {
        const parts: any[] = Array.from((room as any).remoteParticipants?.values?.() || []);
        const firstN = parts.slice(0, 5);
        for (const p of firstN) {
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') { try { pub.setSubscribed?.(true); } catch {} }
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  return {
    async stop() {
      alive = false;
      try { await room.disconnect(); } catch {}
    }
  };
}


