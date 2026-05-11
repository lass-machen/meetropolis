/**
 * WebSocket patch for Safari/WKWebView.
 *
 * Important: this module MUST be imported FIRST in main.tsx.
 *
 * Problem: Colyseus.js caches the WebSocket reference at module scope:
 *   const WebSocket = globalThis.WebSocket || NodeWebSocket;
 *
 * It then calls:
 *   new WebSocket(url, { headers, protocols })
 *
 * Chrome throws an error and falls back to a protocols-only call.
 * WKWebView (Safari/Tauri) does NOT throw; it stringifies the object to
 * "[object Object]" as the protocol, which fails the handshake.
 *
 * Fix: patch globalThis.WebSocket BEFORE any other module loads.
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
