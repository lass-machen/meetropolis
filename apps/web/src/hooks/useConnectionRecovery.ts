/**
 * Connection recovery hooks.
 *
 * Generic hooks for server health checks and WebSocket/Colyseus disconnect
 * handling. Not Tauri specific: they work in any runtime.
 */

import React from 'react';
import { logger } from '../lib/logger';
import type { WorldRoom } from '../types/colyseus';

interface HealthCheckContext {
  apiBase: string;
  isServerHealthy: boolean;
  setIsServerHealthy: React.Dispatch<React.SetStateAction<boolean>>;
  setDisconnectCount: React.Dispatch<React.SetStateAction<number>>;
  lastHealthyRef: React.MutableRefObject<number>;
  reloadScheduledRef: React.MutableRefObject<boolean>;
  onDisconnect: (() => void) | undefined;
  onReconnect: (() => void) | undefined;
}

function handleHealthyResponse(ctx: HealthCheckContext) {
  if (!ctx.isServerHealthy) {
    logger.debug('[HealthCheck] Server is back online');
    ctx.setIsServerHealthy(true);
    ctx.setDisconnectCount(0);
    ctx.onReconnect?.();

    // Execute a previously scheduled reload now that the server is back.
    if (ctx.reloadScheduledRef.current) {
      ctx.reloadScheduledRef.current = false;
      logger.debug('[HealthCheck] Reloading after reconnect...');
      setTimeout(() => window.location.reload(), 500);
    }
  }
  ctx.lastHealthyRef.current = Date.now();
}

function handleUnhealthyResponse(ctx: HealthCheckContext) {
  if (ctx.isServerHealthy) {
    logger.warn('[HealthCheck] Server appears to be down');
    ctx.setIsServerHealthy(false);
    ctx.onDisconnect?.();
  }
  ctx.setDisconnectCount((c) => c + 1);
}

async function performHealthCheck(ctx: HealthCheckContext) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${ctx.apiBase}/health`, {
      signal: controller.signal,
      credentials: 'include',
    });

    clearTimeout(timeout);

    if (response.ok) {
      handleHealthyResponse(ctx);
    } else {
      handleUnhealthyResponse(ctx);
    }
  } catch (_error) {
    handleUnhealthyResponse(ctx);
  }
}

/**
 * Hook that auto-reloads the page after a sustained server disconnect.
 *
 * Detects when the server is unreachable and schedules a reload after a
 * short delay.
 */
export function useServerHealthCheck(options: {
  enabled: boolean;
  apiBase: string;
  onDisconnect?: () => void;
  onReconnect?: () => void;
}) {
  const { enabled, apiBase, onDisconnect, onReconnect } = options;
  const [isServerHealthy, setIsServerHealthy] = React.useState(true);
  const [disconnectCount, setDisconnectCount] = React.useState(0);
  const lastHealthyRef = React.useRef(Date.now());
  const reloadScheduledRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) return;

    const ctx: HealthCheckContext = {
      apiBase,
      isServerHealthy,
      setIsServerHealthy,
      setDisconnectCount,
      lastHealthyRef,
      reloadScheduledRef,
      onDisconnect,
      onReconnect,
    };

    const checkHealth = () => {
      void performHealthCheck(ctx);
    };

    // Poll health every 10 seconds.
    const interval = setInterval(checkHealth, 10000);

    // First check after a 2 second warm-up.
    const initialCheck = setTimeout(checkHealth, 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialCheck);
    };
  }, [enabled, apiBase, isServerHealthy, onDisconnect, onReconnect]);

  // Auto-reload after an extended disconnect.
  React.useEffect(() => {
    if (!enabled || isServerHealthy) return;

    // After 5 failed attempts (about 50 seconds), schedule a reload.
    if (disconnectCount >= 5 && !reloadScheduledRef.current) {
      logger.debug('[HealthCheck] Scheduling reload after multiple failures');
      reloadScheduledRef.current = true;
    }
  }, [enabled, isServerHealthy, disconnectCount]);

  return {
    isServerHealthy,
    disconnectCount,
  };
}

/**
 * Hook handling WebSocket/Colyseus disconnects.
 *
 * Detects when the Colyseus connection drops and either shows a reload
 * banner or triggers an automatic reload.
 */
export function useConnectionRecovery(options: {
  enabled: boolean;
  colyseusRef: React.MutableRefObject<WorldRoom | null>;
  onConnectionLost?: () => void;
  onConnectionRestored?: () => void;
}) {
  const { enabled, colyseusRef, onConnectionLost, onConnectionRestored } = options;
  const [isConnected, setIsConnected] = React.useState(true);
  const [showReloadBanner, setShowReloadBanner] = React.useState(false);
  const disconnectTimeRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!enabled) return;

    const checkConnection = () => {
      const room = colyseusRef.current;
      if (!room) {
        // Not connected yet, nothing to recover.
        return;
      }

      // Inspect the underlying WebSocket. `connection.ws`/`_transport` are
      // Colyseus internals not surfaced in the public types, so narrow cast
      // here instead of falling back to a global `any`.
      type ConnectionInternals = {
        ws?: WebSocket;
        transport?: { ws?: WebSocket };
        _transport?: { ws?: WebSocket };
        isOpen?: boolean;
      };
      const conn = room.connection as unknown as ConnectionInternals;
      const ws = conn.ws ?? conn.transport?.ws ?? conn._transport?.ws;
      const wsReady = ws?.readyState;
      const isOpen = conn.isOpen === true || wsReady === 1;

      if (!isOpen && isConnected) {
        // Connection lost.
        logger.warn('[ConnectionRecovery] Connection lost');
        setIsConnected(false);
        disconnectTimeRef.current = Date.now();
        onConnectionLost?.();

        // Surface the reload banner after 10 seconds.
        setTimeout(() => {
          if (!isConnected) {
            setShowReloadBanner(true);
          }
        }, 10000);
      } else if (isOpen && !isConnected) {
        // Connection restored.
        logger.debug('[ConnectionRecovery] Connection restored');
        setIsConnected(true);
        setShowReloadBanner(false);
        disconnectTimeRef.current = null;
        onConnectionRestored?.();
      }
    };

    const interval = setInterval(checkConnection, 2000);

    return () => clearInterval(interval);
  }, [enabled, colyseusRef, isConnected, onConnectionLost, onConnectionRestored]);

  const handleReload = React.useCallback(() => {
    window.location.reload();
  }, []);

  return {
    isConnected,
    showReloadBanner,
    handleReload,
    dismissBanner: () => setShowReloadBanner(false),
  };
}
