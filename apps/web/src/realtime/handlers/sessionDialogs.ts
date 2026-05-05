/**
 * DOM-Modal-Helfer fuer Realtime-Lifecycle-Events.
 *
 * Bewusst frei von React: laufen out-of-band waehrend einer aktiven Colyseus-
 * Session und muessen unabhaengig von React-Render-Zyklen blocken / unblocken.
 * Wir blasen die useWorldRoom-Effekt nicht weiter mit Inline-HTML auf.
 */
import i18n from '../../app/providers/i18n';
import { logger } from '../../lib/logger';

interface SessionConflictDeps {
  room: { send: (event: string, payload?: any) => void };
  meId: string;
}

export function showSessionConflictDialog(deps: SessionConflictDeps): void {
  logger.info('[useWorldRoom] Session conflict detected — showing takeover dialog');
  if (typeof window !== 'undefined') {
    (window as any).__sessionConflictPending = true;
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
  host.innerHTML = `
    <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(59,130,246,0.5);background:rgba(30,41,59,0.95);backdrop-filter:blur(8px);color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">🔄</div>
      <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('sessionConflict.title')}</div>
      <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${i18n.t('sessionConflict.description')}</div>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button data-session-cancel style="padding:10px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.cancel')}</button>
        <button data-session-takeover style="padding:10px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.takeover')}</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  host.querySelector('[data-session-takeover]')?.addEventListener('click', () => {
    try { host.remove(); } catch {}
    try { delete (window as any).__sessionConflictPending; } catch {}
    deps.room.send('session_takeover', { identity: deps.meId });
  }, { once: true });

  host.querySelector('[data-session-cancel]')?.addEventListener('click', () => {
    try { host.remove(); } catch {}
    try { delete (window as any).__sessionConflictPending; } catch {}
    deps.room.send('session_takeover_cancel', {});
  }, { once: true });
}

interface ServerRestartDeps {
  apiBase: string;
  /** Caller-Hook, um disposed=true zu setzen, damit kein Reconnect-Versuch mehr laeuft. */
  onRestartDetected: () => void;
}

export function showServerRestartDialog(deps: ServerRestartDeps): void {
  logger.info('[useWorldRoom] Server restart notification received');
  deps.onRestartDetected();

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';
  host.innerHTML = `
    <div style="min-width:320px;max-width:480px;padding:32px;border-radius:16px;border:1px solid rgba(59,130,246,0.4);background:rgba(15,23,42,0.97);backdrop-filter:blur(12px);color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.5);text-align:center;">
      <div style="margin-bottom:16px;">
        <div style="width:48px;height:48px;margin:0 auto;border:3px solid rgba(59,130,246,0.3);border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </div>
      <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('serverRestart.title')}</div>
      <div data-restart-desc style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${i18n.t('serverRestart.description')}</div>
      <button data-restart-reload style="display:none;padding:10px 24px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('serverRestart.reloadButton')}</button>
    </div>`;
  document.body.appendChild(host);

  let attempts = 0;
  const maxAttempts = 30;
  const pollHealth = setInterval(async () => {
    attempts++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(deps.apiBase + '/health', { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        clearInterval(pollHealth);
        window.location.reload();
        return;
      }
    } catch { /* server not yet back */ }

    if (attempts >= maxAttempts) {
      clearInterval(pollHealth);
      const desc = host.querySelector('[data-restart-desc]');
      const btn = host.querySelector('[data-restart-reload]') as HTMLElement | null;
      if (desc) desc.textContent = i18n.t('serverRestart.manualReload');
      if (btn) btn.style.display = 'inline-block';
    }
  }, 2000);

  host.querySelector('[data-restart-reload]')?.addEventListener('click', () => {
    window.location.reload();
  }, { once: true });
}
