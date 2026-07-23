/**
 * Desktop auth-token bridge.
 *
 * Native clients (Tauri desktop) cannot rely on the cross-site auth cookie, so
 * the server echoes the JWT in the login/registration response body and the
 * desktop module persists it for the fetch interceptor to replay as a Bearer
 * token. These helpers funnel every store/clear through the desktop loader so
 * the OSS build (no desktop submodule) stays a graceful no-op.
 */

import { getDesktopModule } from './desktopLoader';

/** Persist the session token in the desktop context (no-op outside desktop). */
export async function storeDesktopAuthToken(token: string): Promise<void> {
  try {
    const desktop = await getDesktopModule();
    if (desktop) desktop.setDesktopAuthToken(token);
  } catch {
    /* ignore: desktop module absent or storage unavailable */
  }
}

/** Clear the persisted desktop session token (called on logout). */
export async function clearDesktopAuthToken(): Promise<void> {
  try {
    const desktop = await getDesktopModule();
    if (desktop) desktop.setDesktopAuthToken(null);
  } catch {
    /* ignore: desktop module absent or storage unavailable */
  }
}
