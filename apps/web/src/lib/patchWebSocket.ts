/**
 * WebSocket Patch for Safari/WKWebView
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

import { logger } from './logger';

// Patch for all browsers: Safari/WKWebView silently converts object protocols to "[object Object]"
// The inner guard only intervenes when protocols is incorrectly passed as an object
const needsPatch = typeof window !== 'undefined' && typeof globalThis.WebSocket !== 'undefined';

if (needsPatch) {
  const OriginalWebSocket = globalThis.WebSocket;

  if (OriginalWebSocket) {
    // Patch the global WebSocket constructor at runtime. TS sees the assignment
    // as fine because PatchedWebSocket is structurally compatible.
    globalThis.WebSocket = function PatchedWebSocket(
      url: string,
      protocols?: string | string[] | Record<string, unknown>,
    ): WebSocket {
      // If protocols is an object (not array, not string), handle it
      if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
        logger.debug('[WebSocket Patch] Detected object as protocols, extracting...');
        const actualProtocols = (protocols as any).protocols;
        if (Array.isArray(actualProtocols)) {
          return new OriginalWebSocket(url, actualProtocols);
        } else {
          // No protocols specified, connect without
          return new OriginalWebSocket(url);
        }
      }
      // Normal case - pass through
      return new OriginalWebSocket(url, protocols);
    } as any;

    // Copy static properties
    (globalThis.WebSocket as any).CONNECTING = OriginalWebSocket.CONNECTING;
    (globalThis.WebSocket as any).OPEN = OriginalWebSocket.OPEN;
    (globalThis.WebSocket as any).CLOSING = OriginalWebSocket.CLOSING;
    (globalThis.WebSocket as any).CLOSED = OriginalWebSocket.CLOSED;

    // Preserve prototype for instanceof checks
    globalThis.WebSocket.prototype = OriginalWebSocket.prototype;

    logger.debug('[WebSocket Patch] Patched globalThis.WebSocket for Safari/WKWebView compatibility');
  }
}

export {};
