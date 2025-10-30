// Correlation utilities for client-side A/V logging and server requests

function generateSessionId(): string {
  try {
    const arr = new Uint8Array(16);
    (crypto as any).getRandomValues?.(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}

let cachedSessionId: string | null = null;

export function getCorrelationSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  try {
    const w: any = window as any;
    if (w.__corrSessionId && typeof w.__corrSessionId === 'string') {
      cachedSessionId = w.__corrSessionId;
      return cachedSessionId;
    }
    cachedSessionId = generateSessionId();
    w.__corrSessionId = cachedSessionId;
    return cachedSessionId;
  } catch {
    cachedSessionId = generateSessionId();
    return cachedSessionId;
  }
}

export function buildCorrelationHeaders(extra?: { identity?: string; roomName?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': getCorrelationSessionId(),
  };
  if (extra?.identity) headers['x-av-identity'] = String(extra.identity);
  if (extra?.roomName) headers['x-av-room'] = String(extra.roomName);
  return headers;
}


