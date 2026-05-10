export function installPageLeaveGuards(onLeave: () => void): () => void {
  const handler = () => onLeave();
  try {
    window.addEventListener('pagehide', handler, { capture: true });
  } catch {}
  try {
    window.addEventListener('beforeunload', handler as any, { capture: true });
  } catch {}
  try {
    document.addEventListener(
      'visibilitychange',
      () => {
        try {
          if (document.visibilityState === 'hidden') handler();
        } catch {}
      },
      { capture: true },
    );
  } catch {}
  return () => {
    try {
      window.removeEventListener('pagehide', handler as any, true);
    } catch {}
    try {
      window.removeEventListener('beforeunload', handler as any, true);
    } catch {}
  };
}
