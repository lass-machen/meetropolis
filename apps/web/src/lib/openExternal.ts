import { getDesktopModule } from './desktopLoader';

/**
 * Öffnet eine URL im externen Browser.
 * Desktop (Tauri): Nutzt Shell Plugin via Desktop-Modul.
 * Browser: window.open
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
