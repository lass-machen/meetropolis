import { getDesktopModule } from './desktopLoader';

/**
 * Open a URL in the external browser.
 * Desktop (Tauri): uses the Shell plugin via the desktop module.
 * Browser: falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    const desktop = await getDesktopModule();
    if (desktop) {
      await desktop.openExternal(url);
      return;
    }
  } catch {}
  window.open(url, '_blank');
}
