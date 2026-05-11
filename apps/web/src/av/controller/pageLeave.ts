export function installPageLeaveGuards(onLeave: () => void): () => void {
  // Single EventListener kept across pagehide/beforeunload/visibilitychange so
  // it can be removed cleanly from each target. The DOM accepts a plain
  // `EventListener` for both `BeforeUnloadEvent` and `PageTransitionEvent`
  // overloads because the listener never reads the event payload.
  const handler: EventListener = () => onLeave();
  try {
    window.addEventListener('pagehide', handler, { capture: true });
  } catch {}
  try {
    window.addEventListener('beforeunload', handler, { capture: true });
  } catch {}
  try {
    document.addEventListener(
      'visibilitychange',
      () => {
        try {
          if (document.visibilityState === 'hidden') handler(new Event('visibilitychange'));
        } catch {}
      },
      { capture: true },
    );
  } catch {}
  return () => {
    try {
      window.removeEventListener('pagehide', handler, true);
    } catch {}
    try {
      window.removeEventListener('beforeunload', handler, true);
    } catch {}
  };
}
