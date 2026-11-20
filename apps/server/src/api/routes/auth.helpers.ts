import type express from 'express';

export function isNativeClientRequest(req: express.Request): boolean {
  const origin = req.headers.origin || '';
  if (!origin) return true;
  // Tauri v2 uses a per-platform origin for the bundled webview:
  //   macOS / iOS:      tauri://localhost
  //   Windows / Linux:  http://tauri.localhost   (WebView2 / WebKitGTK)
  // Native clients cannot rely on the cross-site auth cookie, so they need
  // the JWT in the response body. Recognise every Tauri origin, not just the
  // custom scheme, otherwise desktop login/registration silently fails on
  // Windows and Linux (token never reaches the client).
  if (origin.startsWith('tauri://')) return true;
  try {
    return new URL(origin).hostname === 'tauri.localhost';
  } catch {
    return false;
  }
}

export function getRequestToken(req: express.Request): string | null {
  return (req.cookies?.auth_token as string | undefined) || req.headers.authorization?.replace('Bearer ', '') || null;
}

/** Public shape of the JSON body returned by the sign-in / registration routes. */
export interface SigninResponseBody {
  id: string;
  email: string;
  name: string | null;
  token?: string;
}

/**
 * Build the response body for a successful login/registration.
 *
 * Browsers authenticate via the httpOnly `auth_token` cookie, so the body
 * carries only the public profile. Native clients (Tauri desktop) cannot rely
 * on the cross-site cookie, so the freshly signed JWT is echoed in the body for
 * them to persist and replay as a Bearer token. `isNative` is expected to come
 * from `isNativeClientRequest(req)` at the call site.
 */
export function buildSigninResponseBody(
  user: { id: string; email: string; name: string | null },
  token: string,
  isNative: boolean,
): SigninResponseBody {
  return { id: user.id, email: user.email, name: user.name, ...(isNative && { token }) };
}
