import type { Room, RemoteParticipant } from 'livekit-client';
import { listPublications, readPubKind, readPubSource } from '../../types/livekit';

export type AVDebugPayload = {
  roomName: string;
  identity: string;
  connectionState?: string;
  iceState?: string | undefined;
  dtlsState?: string | undefined;
  nRemoteAudio?: number;
  nRemoteVideo?: number;
  nLocalAudio?: number;
  nLocalVideo?: number;
};

interface StatsManagerView {
  current: Room | null;
  currentName?: string | null;
  identity: string;
  baseUrl: string;
  statsTimer?: ReturnType<typeof setInterval>;
}

// Manager is intentionally typed only structurally to avoid tight coupling to the internal class.
export function startStatsLoopImpl(manager: StatsManagerView): void {
  try {
    if (manager.statsTimer) clearInterval(manager.statsTimer);
  } catch {}
  const roomName: string = manager.currentName || 'world';
  const identity: string = manager.identity;
  const baseUrl: string = manager.baseUrl;

  const collectOnce = async () => {
    try {
      const room = manager.current;
      if (!room) return;
      const roomLike = room as unknown as {
        connectionState?: string;
        state?: string;
        engine?: { pcManager?: { publisher?: { pc?: RTCPeerConnection } } };
        pc?: RTCPeerConnection;
      };
      const connectionState = roomLike.connectionState ?? roomLike.state ?? '';
      let nRemoteAudio = 0,
        nRemoteVideo = 0,
        nLocalAudio = 0,
        nLocalVideo = 0;
      try {
        const participants: RemoteParticipant[] = Array.from(room.remoteParticipants?.values?.() || []);
        for (const p of participants) {
          const pubs = listPublications(p);
          for (const pub of pubs) {
            const kind = readPubKind(pub);
            if (kind === 'audio') nRemoteAudio++;
            if (kind === 'video') nRemoteVideo++;
          }
        }
        const pubsLocal = listPublications(room.localParticipant);
        for (const pub of pubsLocal) {
          const kind = readPubKind(pub);
          const src = readPubSource(pub);
          if (kind === 'audio' || src === 'microphone') nLocalAudio++;
          if ((kind === 'video' && src !== 'screen_share') || src === 'camera') nLocalVideo++;
        }
      } catch {}
      let iceState: string | undefined;
      let dtlsState: string | undefined;
      try {
        const pc = roomLike.engine?.pcManager?.publisher?.pc || roomLike.pc;
        if (pc) {
          iceState = String(pc.iceConnectionState || pc.connectionState || '');
          dtlsState = String(pc.connectionState || '');
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
      try {
        updateDebugHudImpl(manager, payload);
      } catch {}
      await fetch(`${baseUrl}/av/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
  };
  manager.statsTimer = setInterval(() => {
    void collectOnce();
  }, 5000);
  void collectOnce();
}

export function updateDebugHudImpl(_manager: StatsManagerView, p: AVDebugPayload): void {
  const w = window as unknown as { __avDebugOn?: boolean };
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
