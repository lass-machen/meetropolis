import type { UseWorldRoomArgs } from '../types';
import type {
  RemoteControlMessage,
  RemoteControlsForMessage,
  RemoteControlsMessage,
  WorldRoom,
} from '../../types/colyseus';

// Local alias used throughout the file. Matches the server-side payload
// emitted by API broadcasts (apps/server/src/api/utils/broadcast.ts).
type RemoteControlPayload = RemoteControlMessage;

function showForceMutedToast(): Promise<void> {
  return import('../../lib/i18n')
    .then(({ default: i18n }) => {
      const title = i18n.t('participant.forceMutedSelfTitle');
      const desc = i18n.t('participant.forceMutedSelfDesc');
      const close = i18n.t('toast.close');
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.bottom = '16px';
      host.style.right = '16px';
      host.style.zIndex = '120';
      host.innerHTML = `
      <div style="display:grid;gap:6px;min-width:240px;max-width:420px;padding:12px;border-radius:10px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.15);color:var(--fg);box-shadow:var(--shadow)">
        <div style="font-weight:700;">${title}</div>
        <div style="font-size:13px;color:var(--fg-subtle)">${desc}</div>
        <div style="display:flex;justify-content:flex-end">
          <button data-toast-close style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--glass);color:var(--fg);cursor:pointer">${close}</button>
        </div>
      </div>`;
      document.body.appendChild(host);
      const remove = () => {
        try {
          host.remove();
        } catch {}
      };
      try {
        host.querySelector('[data-toast-close]')?.addEventListener('click', remove, { once: true });
      } catch {}
      setTimeout(remove, 4500);
    })
    .catch(() => {});
}

async function applyMicControl(target: boolean, args: UseWorldRoomArgs): Promise<void> {
  const { avRef, setAvState } = args;
  const roomRef = avRef.current?.room ?? null;
  const { isLocalMicOn } = await import('../../av/core/localState');
  const current = isLocalMicOn(roomRef);
  if (current === target) return;
  await avRef.current?.setMicrophoneEnabled(target);
  // Refresh the UI with the actual state.
  try {
    const real = isLocalMicOn(roomRef);
    setAvState((s) => ({ ...s, mic: real }));
  } catch {}
  // Brief re-check to catch pending/signaling transitions.
  setTimeout(() => {
    try {
      const again = isLocalMicOn(avRef.current?.room ?? null);
      setAvState((s) => ({ ...s, mic: again }));
    } catch {}
  }, 400);
  if (!target) {
    try {
      await showForceMutedToast();
    } catch {}
  }
}

async function applyCamControl(target: boolean, args: UseWorldRoomArgs): Promise<void> {
  const { avRef, setAvState } = args;
  const roomRef = avRef.current?.room ?? null;
  const { isLocalCamOn } = await import('../../av/core/localState');
  const current = isLocalCamOn(roomRef);
  if (current === target) return;
  await avRef.current?.setCameraEnabled(target);
  // Refresh the UI with the actual state.
  try {
    const real = isLocalCamOn(roomRef);
    setAvState((s) => ({ ...s, cam: real }));
  } catch {}
  setTimeout(() => {
    try {
      const again = isLocalCamOn(avRef.current?.room ?? null);
      setAvState((s) => ({ ...s, cam: again }));
    } catch {}
  }, 400);
}

async function applyShareControl(target: boolean, args: UseWorldRoomArgs): Promise<void> {
  const { avRef, setAvState } = args;
  const roomRef = avRef.current?.room ?? null;
  const { isLocalShareOn } = await import('../../av/core/localState');
  const current = isLocalShareOn(roomRef);
  if (target && !current) {
    const ok = await avRef.current?.startScreenshare();
    if (ok) setAvState((s) => ({ ...s, share: true }));
  } else if (!target && current) {
    await avRef.current?.stopScreenshare();
    setAvState((s) => ({ ...s, share: false }));
  }
  // Brief re-check for screen-share state.
  setTimeout(() => {
    try {
      const again = isLocalShareOn(avRef.current?.room ?? null);
      setAvState((s) => ({ ...s, share: again }));
    } catch {}
  }, 400);
}

async function applyDndControl(target: boolean, args: UseWorldRoomArgs): Promise<void> {
  const { avRef, gameBridge, dndRef, setAvState, applyVolumesToUi, colyseusRef } = args;
  try {
    await avRef.current?.setDoNotDisturb(target);
  } catch {}
  if (gameBridge && typeof gameBridge.setDoNotDisturb === 'function') gameBridge.setDoNotDisturb(target);
  if (target) {
    try {
      await avRef.current?.setMicrophoneEnabled(false);
    } catch {}
    try {
      await avRef.current?.setCameraEnabled(false);
    } catch {}
    try {
      await avRef.current?.stopScreenshare();
    } catch {}
  }
  setAvState((s) => ({
    ...s,
    dnd: target,
    mic: target ? false : s.mic,
    cam: target ? false : s.cam,
    share: target ? false : s.share,
  }));
  dndRef.current = target;
  try {
    colyseusRef.current?.send?.('dnd_status', { dnd: target });
  } catch {}
  // DND affects volume and mute state; re-apply the UI volumes.
  try {
    applyVolumesToUi();
  } catch {}
  // Shortly after, verify the real mic/cam/share state and reconcile the UI.
  setTimeout(() => {
    void (async () => {
      try {
        const mod = await import('../../av/core/localState');
        const r = avRef.current?.room ?? null;
        const realMic = mod.isLocalMicOn(r);
        const realCam = mod.isLocalCamOn(r);
        const realShare = mod.isLocalShareOn(r);
        setAvState((s) => ({
          ...s,
          mic: target ? false : realMic,
          cam: target ? false : realCam,
          share: target ? false : realShare,
        }));
      } catch {}
    })();
  }, 450);
}

async function applyRemoteControl(payload: RemoteControlPayload, args: UseWorldRoomArgs): Promise<void> {
  if (typeof payload.mic === 'boolean') {
    try {
      await applyMicControl(!!payload.mic, args);
    } catch {}
  }
  if (typeof payload.cam === 'boolean') {
    try {
      await applyCamControl(!!payload.cam, args);
    } catch {}
  }
  if (typeof payload.share === 'boolean') {
    try {
      await applyShareControl(!!payload.share, args);
    } catch {}
  }
  if (typeof payload.dnd === 'boolean') {
    await applyDndControl(!!payload.dnd, args);
  }
}

export function setupRemoteControlHandlers(room: WorldRoom, args: UseWorldRoomArgs) {
  const { avRef, me } = args;

  room.onMessage('remote_control', (payload: RemoteControlMessage) => {
    void applyRemoteControl(payload || {}, args);
  });

  room.onMessage('remote_controls', (msg: RemoteControlsMessage) => {
    if (msg?.payload) {
      void applyRemoteControl(msg.payload, args);
    }
  });

  room.onMessage('remote_controls_for', (msg: RemoteControlsForMessage) => {
    const localIdentity = avRef.current?.room?.localParticipant?.identity || me?.id;
    if (!msg?.forIdentity || String(localIdentity || '') !== String(msg.forIdentity || '')) return;
    if (msg?.payload) {
      void applyRemoteControl(msg.payload, args);
    }
  });
}
