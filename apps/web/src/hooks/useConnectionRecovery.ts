/**
 * Connection Recovery Hooks
 *
 * Generische Hooks für Server-Health-Check und WebSocket/Colyseus-Disconnect-Handling.
 * Nicht Tauri-spezifisch — funktioniert in jeder Umgebung.
 */

import React from 'react';
import { logger } from '../lib/logger';

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

    // Wenn wir einen Reload geplant hatten, führen wir ihn jetzt aus
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
 * Hook für Auto-Reload bei Server-Disconnect
 *
 * Erkennt wenn der Server nicht erreichbar ist und initiiert automatisch
 * einen Reload nach einer kurzen Wartezeit.
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

    // Führe Health-Check alle 10 Sekunden durch
    const interval = setInterval(checkHealth, 10000);

    // Initial check nach 2 Sekunden
    const initialCheck = setTimeout(checkHealth, 2000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialCheck);
    };
  }, [enabled, apiBase, isServerHealthy, onDisconnect, onReconnect]);

  // Auto-Reload nach langem Disconnect
  React.useEffect(() => {
    if (!enabled || isServerHealthy) return;

    // Nach 5 fehlgeschlagenen Versuchen (ca. 50 Sekunden), plane Reload
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
 * Hook für WebSocket/Colyseus Disconnect-Handling
 *
 * Erkennt wenn die Colyseus-Verbindung verloren geht und zeigt
 * eine Reload-Option oder lädt automatisch neu.
 */
export function useConnectionRecovery(options: {
  enabled: boolean;
  colyseusRef: React.MutableRefObject<any>;
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
        // Noch nicht verbunden - kein Problem
        return;
      }

      // Prüfe WebSocket-Status
      const ws = room?.connection?.ws ?? room?.connection?.transport?.ws ?? room?.connection?._transport?.ws;
      const wsReady = ws?.readyState;
      const isOpen = room?.connection?.isOpen === true || wsReady === 1;

      if (!isOpen && isConnected) {
        // Verbindung verloren
        logger.warn('[ConnectionRecovery] Connection lost');
        setIsConnected(false);
        disconnectTimeRef.current = Date.now();
        onConnectionLost?.();

        // Nach 10 Sekunden Banner zeigen
        setTimeout(() => {
          if (!isConnected) {
            setShowReloadBanner(true);
          }
        }, 10000);
      } else if (isOpen && !isConnected) {
        // Verbindung wiederhergestellt
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
