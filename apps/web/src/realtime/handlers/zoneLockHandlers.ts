import { useZoneLockStore } from '../../state/zoneLockStore';
import i18n from '../../app/providers/i18n';

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
          title: i18n.t('zone.lockedTitle'),
          description: payload?.zoneName
            ? i18n.t('zone.lockedDesc', { name: payload.zoneName })
            : i18n.t('zone.lockedDescGeneric'),
          intent: 'warning',
        },
      }));
    } catch {}
  });

  room.onMessage('zone_access_denied', (payload: { zoneName?: string }) => {
    try {
      window.dispatchEvent(new CustomEvent('editor:toast', {
        detail: {
          title: i18n.t('zone.deniedTitle'),
          description: payload?.zoneName
            ? i18n.t('zone.deniedDesc', { name: payload.zoneName })
            : i18n.t('zone.deniedDescGeneric'),
          intent: 'error',
        },
      }));
    } catch {}
  });
}
