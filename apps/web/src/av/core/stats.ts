export type AVDebugPayload = {
  roomName: string;
  identity: string;
  connectionState?: string;
  iceState?: string;
  dtlsState?: string;
  nRemoteAudio?: number;
  nRemoteVideo?: number;
  nLocalAudio?: number;
  nLocalVideo?: number;
};

// Manager wird absichtlich als any getypt, um enge Kopplung an die interne Klasse zu vermeiden
export function startStatsLoopImpl(manager: any): void {
  try { if (manager.statsTimer) clearInterval(manager.statsTimer); } catch {}
  const roomName: string = manager.currentName || 'world';
  const identity: string = manager.identity;
  const baseUrl: string = manager.baseUrl;

  const collectOnce = async () => {
    try {
      const room: any = manager.current as any;
      if (!room) return;
      const connectionState = (room.connectionState || room.state || '').toString();
      let nRemoteAudio = 0, nRemoteVideo = 0, nLocalAudio = 0, nLocalVideo = 0;
      try {
        const participants: any[] = Array.from((room.remoteParticipants?.values?.() || []) as any);
        for (const p of participants) {
          const pubs: any[] = Array.from((p.trackPublications?.values?.() || []) as any);
          for (const pub of pubs) {
            const kind = (pub as any).kind ?? (pub.track as any)?.kind;
            if (kind === 'audio') nRemoteAudio++;
            if (kind === 'video') nRemoteVideo++;
          }
        }
        const pubsLocal: any[] = Array.from((room.localParticipant?.trackPublications?.values?.() || []) as any);
        for (const pub of pubsLocal) {
          const kind = (pub as any).kind ?? (pub.track as any)?.kind;
          const src = (pub as any).source ?? (pub.track as any)?.source;
          if (kind === 'audio' || src === 'microphone') nLocalAudio++;
          if ((kind === 'video' && src !== 'screen_share') || src === 'camera') nLocalVideo++;
        }
      } catch {}
      let iceState: string | undefined;
      let dtlsState: string | undefined;
      try {
        const pc = (room as any)?.engine?.pcManager?.publisher?.pc || (room as any)?.pc;
        if (pc) {
          iceState = (pc.iceConnectionState || pc.connectionState || '').toString();
          dtlsState = (pc.connectionState || '').toString();
        }
      } catch {}
      const payload: AVDebugPayload = {
        roomName,
        identity,
        connectionState,
        iceState,
        dtlsState,
        nRemoteAudio,
        nRemoteVideo,
        nLocalAudio,
        nLocalVideo,
      };
      try { updateDebugHudImpl(manager, payload); } catch {}
      await fetch(`${baseUrl}/av/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  };
  manager.statsTimer = setInterval(() => { void collectOnce(); }, 5000);
  void collectOnce();
}

export function updateDebugHudImpl(manager: any, p: AVDebugPayload): void {
  const w: any = window as any;
  if (!w.__avDebugOn) return;
  let el = document.getElementById('av-debug-hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'av-debug-hud';
    el.style.position = 'fixed';
    el.style.right = '12px';
    el.style.bottom = '12px';
    el.style.zIndex = '2147483647';
    el.style.background = 'rgba(0,0,0,0.7)';
    el.style.color = '#fff';
    el.style.padding = '10px 12px';
    el.style.borderRadius = '8px';
    el.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
  }
  const lines = [
    `AV Debug (Alt+D)`,
    `room: ${p.roomName}  id: ${p.identity}`,
    `state: ${p.connectionState || '-'}  ice: ${p.iceState || '-'}  dtls: ${p.dtlsState || '-'}`,
    `tracks L[a:${p.nLocalAudio ?? 0}|v:${p.nLocalVideo ?? 0}]  R[a:${p.nRemoteAudio ?? 0}|v:${p.nRemoteVideo ?? 0}]`,
  ];
  el.textContent = lines.join('\n');
}


