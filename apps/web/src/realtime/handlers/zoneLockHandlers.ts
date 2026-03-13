import { useZoneLockStore } from '../../state/zoneLockStore';

export function setupZoneLockHandlers(room: any): void {
  room.onMessage('zone_lock_state', (payload: { locks?: any[] }) => {
    const locks = Array.isArray(payload?.locks) ? payload.locks : [];
    useZoneLockStore.getState().setLocks(locks);
  });

  room.onMessage('zone_move_blocked', (payload: { zoneName?: string }) => {
    // Dispatch a custom event for the UI to show a toast
    try {
      window.dispatchEvent(new CustomEvent('editor:toast', {
        detail: {
          title: 'Zone gesperrt',
          description: payload?.zoneName
            ? `Die Zone "${payload.zoneName}" ist gesperrt`
            : 'Diese Zone ist gesperrt',
          intent: 'warning',
        },
      }));
    } catch {}
  });

  room.onMessage('zone_access_denied', (payload: { zoneName?: string }) => {
    try {
      window.dispatchEvent(new CustomEvent('editor:toast', {
        detail: {
          title: 'Zugang verweigert',
          description: payload?.zoneName
            ? `Dein Zugang zu "${payload.zoneName}" wurde abgelehnt`
            : 'Dein Zugriffsantrag wurde abgelehnt',
          intent: 'error',
        },
      }));
    } catch {}
  });
}
