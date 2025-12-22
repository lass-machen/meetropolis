import type { UseWorldRoomArgs } from '../types';

export function setupRemoteControlHandlers(
  room: any,
  args: UseWorldRoomArgs
) {
  const {
    avRef,
    gameBridge,
    dndRef,
    setAvState,
    applyVolumesToUi,
    colyseusRef,
    me,
  } = args;

  // Helper, um Remote-Controls konsistent anzuwenden (genutzt von weiteren Message-Typen)
  const applyRemoteControl = async (payload: { mic?: boolean; cam?: boolean; share?: boolean; dnd?: boolean }) => {
    const roomRef: any = avRef.current?.room as any;
    try {
      if (typeof payload.mic === 'boolean') {
        const { isLocalMicOn } = await import('../../av/core/localState');
        const current = isLocalMicOn(roomRef);
        const target = !!payload.mic;
        if (current !== target) {
          await avRef.current?.setMicrophoneEnabled(target);
          // Nachführen UI mit tatsächlichem Zustand
          try {
            const real = isLocalMicOn(roomRef);
            setAvState(s => ({ ...s, mic: real }));
          } catch {}
          // Kurzer Re-Check (Pending/Signaling)
          setTimeout(() => {
            try {
              const again = isLocalMicOn(avRef.current?.room as any);
              setAvState(s => ({ ...s, mic: again }));
            } catch {}
          }, 400);
          try {
            if (!target) {
              const { default: i18n } = await import('../../lib/i18n');
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
              const remove = () => { try { host.remove(); } catch {} };
              try { host.querySelector('[data-toast-close]')?.addEventListener('click', remove, { once: true } as any); } catch {}
              setTimeout(remove, 4500);
            }
          } catch {}
        }
      }
    } catch {}
    try {
      if (typeof payload.cam === 'boolean') {
        const { isLocalCamOn } = await import('../../av/core/localState');
        const current = isLocalCamOn(roomRef);
        const target = !!payload.cam;
        if (current !== target) {
          await avRef.current?.setCameraEnabled(target);
          // Nachführen UI mit tatsächlichem Zustand
          try {
            const real = isLocalCamOn(roomRef);
            setAvState(s => ({ ...s, cam: real }));
          } catch {}
          setTimeout(() => {
            try {
              const again = isLocalCamOn(avRef.current?.room as any);
              setAvState(s => ({ ...s, cam: again }));
            } catch {}
          }, 400);
        }
      }
    } catch {}
    if (typeof payload.share === 'boolean') {
      try {
        const { isLocalShareOn } = await import('../../av/core/localState');
        const current = isLocalShareOn(roomRef);
        const target = !!payload.share;
        if (target && !current) {
          const ok = await avRef.current?.startScreenshare();
          if (ok) setAvState(s => ({ ...s, share: true }));
        } else if (!target && current) {
          await avRef.current?.stopScreenshare();
          setAvState(s => ({ ...s, share: false }));
        }
        // Kurzer Re-Check für Share
        setTimeout(() => {
          try {
            const again = isLocalShareOn(avRef.current?.room as any);
            setAvState(s => ({ ...s, share: again }));
          } catch {}
        }, 400);
      } catch {}
    }
    if (typeof payload.dnd === 'boolean') {
      const next = !!payload.dnd;
      try { await avRef.current?.setDoNotDisturb(next); } catch {}
      if (gameBridge && typeof (gameBridge as any).setDoNotDisturb === 'function') (gameBridge as any).setDoNotDisturb(next);
      if (next) {
        try { await avRef.current?.setMicrophoneEnabled(false); } catch {}
        try { await avRef.current?.setCameraEnabled(false); } catch {}
        try { await avRef.current?.stopScreenshare(); } catch {}
      }
      setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
      dndRef.current = next;
      try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
      // DND beeinflusst Lautstärke/Mute – UI-Volumes neu anwenden
      try { applyVolumesToUi(); } catch {}
      // Verifiziere nach kurzer Zeit den echten Zustand (Mic/Cam/Share) und gleiche UI an
      setTimeout(async () => {
        try {
          const mod: any = await import('../../av/core/localState');
          const r: any = avRef.current?.room as any;
          const realMic = mod.isLocalMicOn(r);
          const realCam = mod.isLocalCamOn(r);
          const realShare = mod.isLocalShareOn(r);
          setAvState(s => ({ ...s, mic: next ? false : realMic, cam: next ? false : realCam, share: next ? false : realShare }));
        } catch {}
      }, 450);
    }
  };

  room.onMessage('remote_control', async (payload: any) => {
    await applyRemoteControl(payload || {});
  });

  room.onMessage('remote_controls', async (msg: any) => {
    if (msg?.payload) {
      await applyRemoteControl(msg.payload);
    }
  });

  room.onMessage('remote_controls_for', async (msg: any) => {
    const localIdentity = avRef.current?.room?.localParticipant?.identity || me?.id;
    if (!msg?.forIdentity || String(localIdentity || '') !== String(msg.forIdentity || '')) return;
    if (msg?.payload) {
      await applyRemoteControl(msg.payload);
    }
  });
}
