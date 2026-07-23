import { useDesktop } from '../hooks/useDesktop';

/**
 * Root-level host for the desktop update banner.
 *
 * The banner used to live inside the authenticated WorldShell, so its
 * update-available listener only existed after login. The updater fires its
 * one-shot event a few seconds into bootstrap — while the app is still on the
 * login/loading screen — so the notification was routinely lost. Mounting the
 * banner here, above the auth gate, keeps the listener active in every app
 * state; the banner also replays the pending update on mount, so an update
 * detected before this component existed still surfaces.
 *
 * Exactly one instance: this replaces the former WorldShell mount, so there is
 * no duplicate listener.
 */
export function DesktopUpdateOverlay() {
  const { desktop } = useDesktop();
  const UpdateBanner = desktop?.UpdateBanner;
  if (!UpdateBanner) return null;
  return <UpdateBanner />;
}
