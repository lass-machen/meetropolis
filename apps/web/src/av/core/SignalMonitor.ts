/**
 * WebSocket Signal Health Monitor
 *
 * Monitors the health of the LiveKit signaling connection.
 * Detects stale connections that appear open but can't send/receive.
 */

import type { Room } from 'livekit-client';
import type { SignalHealth, Disposable } from './types';
import { AVLogger } from '../AVLogger';

export interface SignalMonitorConfig {
  pingIntervalMs: number;
  pingTimeoutMs: number;
  maxMissedPings: number;
}

export type SignalLostHandler = () => void;
export type SignalRestoredHandler = () => void;

export class SignalMonitor implements Disposable {
  private _room: Room | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _health: SignalHealth = {
    isOpen: false,
    lastPingAt: 0,
    lastPongAt: 0,
    missedPings: 0,
    latencyMs: null,
  };
  private _disposed = false;
  private _onSignalLost: SignalLostHandler | null = null;
  private _onSignalRestored: SignalRestoredHandler | null = null;
  private _wasHealthy = false;

  constructor(private readonly config: SignalMonitorConfig) {}

  // ============================================================================
  // Public API
  // ============================================================================

  get health(): SignalHealth {
    return { ...this._health };
  }

  get isHealthy(): boolean {
    return this._health.isOpen && this._health.missedPings < this.config.maxMissedPings;
  }

  setRoom(room: Room | null): void {
    this.stop();
    this._room = room;

    if (room) {
      this.start();
    }
  }

  onSignalLost(handler: SignalLostHandler): void {
    this._onSignalLost = handler;
  }

  onSignalRestored(handler: SignalRestoredHandler): void {
    this._onSignalRestored = handler;
  }

  /**
   * Check if the signal channel is currently open
   * Uses multiple heuristics since WebSocket.readyState can be misleading
   */
  isSignalOpen(): boolean {
    if (!this._room) return false;

    try {
      const roomAny = this._room as any;

      // Check room connection state first (most reliable indicator)
      const connectionState = roomAny.connectionState ?? roomAny.state;
      const isConnected = connectionState === 'connected' || connectionState === 2;

      // If room says connected, trust it (skip WebSocket check)
      if (isConnected) {
        return true;
      }

      // Only check WebSocket if room state is ambiguous
      // Try multiple paths to find the WebSocket
      const ws = roomAny.engine?.signalClient?.ws ?? roomAny.engine?.client?.ws ?? roomAny.engine?.ws;

      if (ws && typeof ws.readyState === 'number') {
        if (ws.readyState === 1) {
          // WebSocket is OPEN
          return true;
        }
      }

      // Check if disconnected explicitly
      if (connectionState === 'disconnected' || connectionState === 3) {
        return false;
      }

      // If we've missed too many pings AND room is not connected, signal is lost
      if (this._health.missedPings >= this.config.maxMissedPings) {
        return false;
      }

      // Default: if room exists and state is not disconnected, assume open
      // This handles "connecting" state and other intermediate states
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force an immediate health check
   */
  checkNow(): boolean {
    this.performHealthCheck();
    return this.isHealthy;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.stop();
    this._room = null;
    this._onSignalLost = null;
    this._onSignalRestored = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private start(): void {
    if (this._pingTimer || this._disposed) return;

    AVLogger.debug('signal.monitor.start', {
      intervalMs: this.config.pingIntervalMs,
    });

    // Initial check
    this.performHealthCheck();
    this._wasHealthy = this.isHealthy;

    // Periodic checks
    this._pingTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.pingIntervalMs);
  }

  private stop(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }

    this._health = {
      isOpen: false,
      lastPingAt: 0,
      lastPongAt: 0,
      missedPings: 0,
      latencyMs: null,
    };
    this._wasHealthy = false;
  }

  private performHealthCheck(): void {
    if (!this._room || this._disposed) return;

    const now = Date.now();
    const wasOpen = this._health.isOpen;
    this._health.lastPingAt = now;

    try {
      const roomAny = this._room as any;

      // Check WebSocket state
      const ws = roomAny.engine?.signalClient?.ws;
      const wsOpen = ws && ws.readyState === 1;

      // Check room state
      const connectionState = roomAny.connectionState ?? roomAny.state;
      const roomConnected = connectionState === 'connected' || connectionState === 2;

      // Determine if signal is open
      const isOpen = wsOpen && roomConnected;
      this._health.isOpen = isOpen;

      if (isOpen) {
        // Signal appears healthy
        this._health.lastPongAt = now;
        this._health.latencyMs = 0; // We don't have actual ping/pong, use 0
        this._health.missedPings = 0;
      } else if (wasOpen) {
        // Signal was open but now isn't
        this._health.missedPings++;
        AVLogger.warn('signal.degraded', {
          missedPings: this._health.missedPings,
          wsReadyState: ws?.readyState,
          connectionState,
        });
      } else {
        // Signal was already not open
        this._health.missedPings++;
      }

      // Detect transitions
      const isNowHealthy = this.isHealthy;
      if (this._wasHealthy && !isNowHealthy) {
        AVLogger.warn('signal.lost', {
          missedPings: this._health.missedPings,
        });
        this._onSignalLost?.();
      } else if (!this._wasHealthy && isNowHealthy) {
        AVLogger.info('signal.restored');
        this._onSignalRestored?.();
      }
      this._wasHealthy = isNowHealthy;
    } catch (error) {
      AVLogger.error('signal.check.error', { error: String(error) });
      this._health.isOpen = false;
      this._health.missedPings++;

      if (this._wasHealthy) {
        this._onSignalLost?.();
        this._wasHealthy = false;
      }
    }
  }
}

/**
 * Utility: Wait for room to reach connected state with timeout
 */
export async function waitForRoomConnected(room: Room, timeoutMs: number = 10000): Promise<boolean> {
  const roomAny = room as any;

  const isConnected = () => {
    const state = roomAny.connectionState ?? roomAny.state;
    // If the room implementation doesn't expose connection state, assume the join call
    // succeeded and don't block callers behind an arbitrary timeout.
    if (state === undefined) return true;
    return state === 'connected' || state === 2;
  };

  if (isConnected()) return true;

  return new Promise<boolean>((resolve) => {
    let resolved = false;
    let cleanup: (() => void) | null = null;

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      cleanup?.();
      resolve(result);
    };

    const timer = setTimeout(() => {
      AVLogger.warn('room.connect.timeout', { timeoutMs });
      finish(false);
    }, timeoutMs);

    const checkState = () => {
      if (isConnected()) {
        clearTimeout(timer);
        finish(true);
      }
    };

    // Try to subscribe to state changes
    void (async () => {
      try {
        const { RoomEvent } = await import('livekit-client');
        const handler = () => checkState();

        room.on(RoomEvent.ConnectionStateChanged, handler);
        cleanup = () => room.off(RoomEvent.ConnectionStateChanged, handler);

        // Check immediately in case state changed while setting up listener
        checkState();
      } catch {
        // Fallback to polling
        const pollTimer = setInterval(() => {
          if (isConnected()) {
            clearInterval(pollTimer);
            clearTimeout(timer);
            finish(true);
          }
        }, 100);

        cleanup = () => clearInterval(pollTimer);
      }
    })();
  });
}
