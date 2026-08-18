import { useMiniModeAuthGuard } from '../hooks/useMiniModeAuthGuard';

/**
 * Renders nothing; exists to be mounted exactly while the world is on screen.
 *
 * WorldApp renders it next to the WorldShell, i.e. behind the auth gate, which
 * makes "the world is showing" a matter of this element being mounted rather
 * than of a boolean somebody has to keep correct. On the desktop client that is
 * the signal to return to the mini window the user asked for; everywhere else the
 * hook is inert. Unmounting reports nothing — the public routes do that, and a
 * remount (a re-auth, for instance) must not flap the window.
 */
export function MiniModeWorldSignal(): null {
  useMiniModeAuthGuard('world');
  return null;
}
