import React from 'react';

export function usePositionPersistence(params: {
  apiBase: string;
  localPosRef: React.MutableRefObject<{ x: number; y: number }>;
  gameBridge: any;
}) {
  const { apiBase, localPosRef, gameBridge } = params;

  React.useEffect(() => {
    let lastSavedPosition = { x: 0, y: 0, direction: 'down' } as { x: number; y: number; direction: string };
    let moveTimeoutRef: any = null;

    const savePosition = async (opts?: { immediate?: boolean }) => {
      const currentPos = localPosRef.current;
      const currentDirection = (gameBridge as any)?.lastDirection || 'down';
      const hasMoved = !!currentPos.x && !!currentPos.y && (
        Math.abs(currentPos.x - lastSavedPosition.x) > 10 ||
        Math.abs(currentPos.y - lastSavedPosition.y) > 10 ||
        currentDirection !== lastSavedPosition.direction
      );
      if (!hasMoved && !opts?.immediate) return;
      lastSavedPosition = { x: currentPos.x || lastSavedPosition.x, y: currentPos.y || lastSavedPosition.y, direction: currentDirection };
      const payload = JSON.stringify({ x: Math.round(lastSavedPosition.x), y: Math.round(lastSavedPosition.y), direction: lastSavedPosition.direction });
      try {
        if (opts?.immediate && 'sendBeacon' in navigator) {
          const blob = new Blob([payload], { type: 'application/json' });
          (navigator as any).sendBeacon?.(`${apiBase}/auth/position`, blob);
        } else {
          await fetch(`${apiBase}/auth/position`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            keepalive: !!opts?.immediate,
            body: payload,
          });
        }
      } catch {}
    };

    const originalOnLocalMove = gameBridge.onLocalMove;
    gameBridge.onLocalMove = (p: any) => {
      try { originalOnLocalMove?.(p); } catch {}
      if (moveTimeoutRef) clearTimeout(moveTimeoutRef);
      moveTimeoutRef = setTimeout(() => { void savePosition(); moveTimeoutRef = null; }, 1000);
    };

    const onVisibility = () => { if (document.hidden) { void savePosition({ immediate: true }); } else { try { (window as any)?.meetropolis_av_room?.startAudio?.(); } catch {} } };
    const onFocus = () => { try { (window as any)?.meetropolis_av_room?.startAudio?.(); } catch {} };
    const onBeforeUnload = () => { void savePosition({ immediate: true }); };
    const onPageHide = () => { void savePosition({ immediate: true }); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);

    return () => {
      if (moveTimeoutRef) clearTimeout(moveTimeoutRef);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
      try { gameBridge.onLocalMove = originalOnLocalMove; } catch {}
    };
  }, [apiBase]);
}


