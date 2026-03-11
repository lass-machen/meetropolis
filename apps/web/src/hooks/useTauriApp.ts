/**
 * useTauriApp Hook
 *
 * Integrationshook für Tauri Desktop App Features:
 * - Mini-Modus (same-window resize + always-on-top)
 * - Reload-Funktionalität
 * - Server-Disconnect-Handling mit Auto-Reload
 */

import React from 'react';
import { logger } from '../lib/logger';

interface TauriAppState {
  isTauri: boolean;
  isMiniMode: boolean;
  toggleMiniMode: () => Promise<void>;
  reload: () => Promise<void>;
}

// Prüft ob wir in einer Tauri-App laufen
function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

export function useTauriApp(): TauriAppState {
  const [isMiniMode, setIsMiniMode] = React.useState(false);
  const isTauri = React.useMemo(() => isTauriEnvironment(), []);

  // Listener für Mini-Mode-Änderungen von Rust (via Tauri events)
  React.useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<boolean>('mini-mode-changed', (event) => {
          setIsMiniMode(event.payload);
        });
      } catch (e) {
        logger.warn('[Tauri] Failed to setup mini-mode listener:', e);
      }
    };

    setupListener();

    // Initial check
    const checkMiniMode = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const miniMode = await invoke<boolean>('is_mini_mode');
        setIsMiniMode(miniMode);
      } catch (e) {
        logger.warn('[Tauri] Failed to check mini mode:', e);
      }
    };
    checkMiniMode();

    return () => {
      unlisten?.();
    };
  }, [isTauri]);

  const toggleMiniMode = React.useCallback(async () => {
    if (!isTauri) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const newMiniMode = await invoke<boolean>('toggle_mini_mode');
      setIsMiniMode(newMiniMode);
    } catch (error) {
      logger.error('[Tauri] Failed to toggle mini mode:', error);
    }
  }, [isTauri]);

  const reload = React.useCallback(async () => {
    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('reload_app');
      } catch (error) {
        window.location.reload();
      }
    } else {
      window.location.reload();
    }
  }, [isTauri]);

  return {
    isTauri,
    isMiniMode,
    toggleMiniMode,
    reload,
  };
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

    const checkHealth = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${apiBase}/health`, {
          signal: controller.signal,
          credentials: 'include',
        });

        clearTimeout(timeout);

        if (response.ok) {
          if (!isServerHealthy) {
            logger.debug('[HealthCheck] Server is back online');
            setIsServerHealthy(true);
            setDisconnectCount(0);
            onReconnect?.();

            // Wenn wir einen Reload geplant hatten, führen wir ihn jetzt aus
            if (reloadScheduledRef.current) {
              reloadScheduledRef.current = false;
              logger.debug('[HealthCheck] Reloading after reconnect...');
              setTimeout(() => window.location.reload(), 500);
            }
          }
          lastHealthyRef.current = Date.now();
        } else {
          handleUnhealthy();
        }
      } catch (error) {
        handleUnhealthy();
      }
    };

    const handleUnhealthy = () => {
      if (isServerHealthy) {
        logger.warn('[HealthCheck] Server appears to be down');
        setIsServerHealthy(false);
        onDisconnect?.();
      }
      setDisconnectCount(c => c + 1);
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
