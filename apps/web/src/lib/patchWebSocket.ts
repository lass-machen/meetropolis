/**
 * WebSocket Patch for WKWebView/Safari (Tauri)
 *
 * WICHTIG: Dieses Modul MUSS als ERSTES in main.tsx importiert werden!
 *
 * Problem: Colyseus.js cached die WebSocket-Referenz auf Modul-Ebene:
 *   const WebSocket = globalThis.WebSocket || NodeWebSocket;
 *
 * Dann ruft es auf:
 *   new WebSocket(url, { headers, protocols })
 *
 * In Chrome wirft das einen Error und fällt auf protocols-only zurück.
 * In WKWebView (Safari/Tauri) wirft es KEINEN Error, sondern konvertiert
 * das Objekt zu "[object Object]" als Protokoll - was fehlschlägt.
 *
 * Lösung: Wir patchen globalThis.WebSocket BEVOR irgendein anderes Modul
 * geladen wird.
 */

// Nur in Tauri-Umgebung patchen
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

if (isTauri) {
  const OriginalWebSocket = globalThis.WebSocket;

  if (OriginalWebSocket) {
    // @ts-ignore - we're patching the global WebSocket
    globalThis.WebSocket = function PatchedWebSocket(
      url: string,
      protocols?: string | string[] | Record<string, any>
    ): WebSocket {
      // If protocols is an object (not array, not string), handle it
      if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
        console.log('[WebSocket Patch] Detected object as protocols, extracting...');
        const actualProtocols = (protocols as any).protocols;
        if (Array.isArray(actualProtocols)) {
          return new OriginalWebSocket(url, actualProtocols);
        } else {
          // No protocols specified, connect without
          return new OriginalWebSocket(url);
        }
      }
      // Normal case - pass through
      return new OriginalWebSocket(url, protocols as string | string[] | undefined);
    } as any;

    // Copy static properties
    (globalThis.WebSocket as any).CONNECTING = OriginalWebSocket.CONNECTING;
    (globalThis.WebSocket as any).OPEN = OriginalWebSocket.OPEN;
    (globalThis.WebSocket as any).CLOSING = OriginalWebSocket.CLOSING;
    (globalThis.WebSocket as any).CLOSED = OriginalWebSocket.CLOSED;

    // Preserve prototype for instanceof checks
    globalThis.WebSocket.prototype = OriginalWebSocket.prototype;

    console.log('[WebSocket Patch] Patched globalThis.WebSocket for WKWebView compatibility');
  }
}

export {};

