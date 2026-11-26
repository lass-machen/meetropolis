export const PENDING_INVITE_KEY = 'meetropolis.pendingInvite';

export function readPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function storePendingInvite(code: string): void {
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, code);
  } catch {
    /* private mode: storage unavailable */
  }
}

export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* private mode: storage unavailable */
  }
}

export function inviteHash(code: string): string {
  return `#/?invite=${encodeURIComponent(code)}`;
}
