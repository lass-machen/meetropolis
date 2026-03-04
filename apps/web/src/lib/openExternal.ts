import { isTauri } from './tauriAuth';

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank');
  }
}
