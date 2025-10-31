export function installPageLeaveGuards(onLeave: () => void): () => void {
  const handler = () => onLeave();
  try { window.addEventListener('pagehide', handler, { capture: true } as any); } catch {}
  try { window.addEventListener('beforeunload', handler as any, { capture: true } as any); } catch {}
  try {
    document.addEventListener('visibilitychange', () => {
      try { if (document.visibilityState === 'hidden') handler(); } catch {}
    }, { capture: true } as any);
  } catch {}
  return () => {
    try { window.removeEventListener('pagehide', handler as any, true); } catch {}
    try { window.removeEventListener('beforeunload', handler as any, true); } catch {}
  };
}


