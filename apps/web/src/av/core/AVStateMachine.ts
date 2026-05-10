/**
 * Finite State Machine for AV Connection Lifecycle
 *
 * States:
 *   idle → connecting → connected → active
 *                    ↓         ↓       ↓
 *                 error ← reconnecting ←
 *                    ↓
 *                 closed
 *
 * This is the single source of truth for connection state.
 */

import type { Room } from 'livekit-client';
import type { AVConnectionState, AVConnectionEvent, Disposable, Unsubscribe } from './types';
import { AVLogger } from '../AVLogger';

export interface AVStateMachineConfig {
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  connectionTimeoutMs: number;
}

export type StateChangeHandler = (
  newState: AVConnectionState,
  prevState: AVConnectionState,
  event: AVConnectionEvent,
) => void;

const VALID_TRANSITIONS: Record<AVConnectionState, AVConnectionState[]> = {
  idle: ['connecting', 'closed'],
  connecting: ['connected', 'error', 'closed'],
  connected: ['active', 'reconnecting', 'closed'],
  active: ['connected', 'reconnecting', 'closed'],
  reconnecting: ['connecting', 'error', 'closed'],
  error: ['connecting', 'closed', 'idle'],
  closed: ['idle', 'connecting'],
};

export class AVStateMachine implements Disposable {
  private _state: AVConnectionState = 'idle';
  private _room: Room | null = null;
  private _roomName: string | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private _listeners: Set<StateChangeHandler> = new Set();
  private _disposed = false;

  // Page visibility tracking
  private _pageHidden = false;
  private _pageLeaving = false;
  private _visibilityHandler: (() => void) | null = null;
  private _pageLeaveHandler: (() => void) | null = null;

  constructor(private readonly config: AVStateMachineConfig) {
    this.setupPageVisibilityTracking();
  }

  // ============================================================================
  // Public Getters
  // ============================================================================

  get state(): AVConnectionState {
    return this._state;
  }

  get room(): Room | null {
    return this._room;
  }

  get roomName(): string | null {
    return this._roomName;
  }

  get isConnected(): boolean {
    return this._state === 'connected' || this._state === 'active';
  }

  get isActive(): boolean {
    return this._state === 'active';
  }

  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  get pageHidden(): boolean {
    return this._pageHidden;
  }

  get pageLeaving(): boolean {
    return this._pageLeaving;
  }

  // ============================================================================
  // State Transitions
  // ============================================================================

  /**
   * Process an event and transition to a new state if valid
   */
  dispatch(event: AVConnectionEvent): boolean {
    if (this._disposed) {
      AVLogger.warn('state.dispatch.disposed', { event: event.type });
      return false;
    }

    const prevState = this._state;
    const nextState = this.getNextState(event);

    if (!nextState) {
      AVLogger.debug('state.dispatch.ignored', {
        event: event.type,
        currentState: this._state,
      });
      return false;
    }

    if (!this.canTransition(nextState)) {
      AVLogger.warn('state.dispatch.invalid', {
        event: event.type,
        from: this._state,
        to: nextState,
      });
      return false;
    }

    // Perform the transition
    this._state = nextState;
    this.handleTransition(prevState, nextState, event);

    AVLogger.info('state.changed', {
      from: prevState,
      to: nextState,
      event: event.type,
    });

    // Notify listeners
    this.notifyListeners(nextState, prevState, event);

    return true;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(handler: StateChangeHandler): Unsubscribe {
    this._listeners.add(handler);
    return () => this._listeners.delete(handler);
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  setRoom(room: Room | null, roomName: string | null): void {
    this._room = room;
    this._roomName = roomName;

    if (room) {
      AVLogger.debug('state.room.set', { roomName });
    } else {
      AVLogger.debug('state.room.cleared');
    }
  }

  // ============================================================================
  // Reconnect Logic
  // ============================================================================

  /**
   * Schedule a reconnect attempt with exponential backoff
   */
  scheduleReconnect(connectFn: () => Promise<void>): void {
    if (this._pageLeaving) {
      AVLogger.info('reconnect.blocked.pageleaving');
      return;
    }

    if (this._reconnectAttempts >= this.config.maxReconnectAttempts) {
      AVLogger.warn('reconnect.max_attempts', {
        attempts: this._reconnectAttempts,
        max: this.config.maxReconnectAttempts,
      });
      this.dispatch({ type: 'MAX_RETRIES' });
      return;
    }

    this._reconnectAttempts++;
    const delay = this.calculateReconnectDelay();

    AVLogger.info('reconnect.scheduled', {
      attempt: this._reconnectAttempts,
      delayMs: delay,
    });

    this.clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      void (async () => {
        this._reconnectTimer = null;

        if (this._pageLeaving) {
          AVLogger.info('reconnect.aborted.pageleaving');
          return;
        }

        this.dispatch({ type: 'RETRY' });

        try {
          await connectFn();
        } catch (error) {
          AVLogger.error('reconnect.failed', { error: String(error) });
          this.scheduleReconnect(connectFn);
        }
      })();
    }, delay);
  }

  /**
   * Cancel any pending reconnect
   */
  cancelReconnect(): void {
    this.clearReconnectTimer();
    this._reconnectAttempts = 0;
  }

  /**
   * Reset reconnect counter (call after successful connection)
   */
  resetReconnect(): void {
    this._reconnectAttempts = 0;
    this.clearReconnectTimer();
  }

  // ============================================================================
  // Connection Timeout
  // ============================================================================

  startConnectionTimeout(onTimeout: () => void): void {
    this.clearConnectionTimer();
    this._connectionTimer = setTimeout(() => {
      this._connectionTimer = null;
      AVLogger.warn('connection.timeout', {
        timeoutMs: this.config.connectionTimeoutMs,
      });
      onTimeout();
    }, this.config.connectionTimeoutMs);
  }

  clearConnectionTimeout(): void {
    this.clearConnectionTimer();
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this.clearReconnectTimer();
    this.clearConnectionTimer();
    this.teardownPageVisibilityTracking();
    this._listeners.clear();
    this._room = null;
    this._roomName = null;
    this._state = 'closed';

    AVLogger.debug('state.disposed');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getNextState(event: AVConnectionEvent): AVConnectionState | null {
    switch (event.type) {
      case 'CONNECT':
        if (this._state === 'idle' || this._state === 'closed' || this._state === 'error') {
          return 'connecting';
        }
        break;

      case 'CONNECTED':
        if (this._state === 'connecting') {
          return 'connected';
        }
        break;

      case 'TRACK_PUBLISHED':
        if (this._state === 'connected') {
          return 'active';
        }
        break;

      case 'ALL_TRACKS_UNPUBLISHED':
        if (this._state === 'active') {
          return 'connected';
        }
        break;

      case 'SIGNAL_LOST':
        if (this._state === 'connected' || this._state === 'active') {
          return 'reconnecting';
        }
        break;

      case 'RETRY':
        if (this._state === 'reconnecting') {
          return 'connecting';
        }
        break;

      case 'MAX_RETRIES':
        if (this._state === 'reconnecting') {
          return 'error';
        }
        break;

      case 'DISCONNECT':
        return 'closed';

      case 'RESET':
        return 'idle';

      case 'ERROR':
        if (this._state === 'connecting') {
          return 'error';
        }
        break;
    }

    return null;
  }

  private canTransition(nextState: AVConnectionState): boolean {
    const validTargets = VALID_TRANSITIONS[this._state];
    return validTargets.includes(nextState);
  }

  private handleTransition(
    _prevState: AVConnectionState,
    nextState: AVConnectionState,
    _event: AVConnectionEvent,
  ): void {
    // Handle side effects of transitions
    switch (nextState) {
      case 'connected':
        this.clearConnectionTimeout();
        this.resetReconnect();
        break;

      case 'reconnecting':
        this.clearConnectionTimeout();
        break;

      case 'closed':
        this.clearConnectionTimeout();
        this.cancelReconnect();
        this._room = null;
        break;

      case 'idle':
        this.clearConnectionTimeout();
        this.cancelReconnect();
        this._room = null;
        this._roomName = null;
        break;

      case 'error':
        this.clearConnectionTimeout();
        break;
    }
  }

  private notifyListeners(newState: AVConnectionState, prevState: AVConnectionState, event: AVConnectionEvent): void {
    for (const handler of this._listeners) {
      try {
        handler(newState, prevState, event);
      } catch (error) {
        AVLogger.error('state.listener.error', { error: String(error) });
      }
    }
  }

  private calculateReconnectDelay(): number {
    const baseDelay = this.config.reconnectBaseDelayMs;
    const maxDelay = this.config.reconnectMaxDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, this._reconnectAttempts - 1);
    const jitter = Math.random() * 500;
    return Math.min(maxDelay, exponentialDelay + jitter);
  }

  private clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private clearConnectionTimer(): void {
    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
  }

  // ============================================================================
  // Page Visibility Tracking
  // ============================================================================

  private setupPageVisibilityTracking(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    this._visibilityHandler = () => {
      const wasHidden = this._pageHidden;
      this._pageHidden = document.visibilityState === 'hidden';

      // IMPORTANT: Reset pageLeaving when page becomes visible again
      if (wasHidden && !this._pageHidden) {
        this._pageLeaving = false;
        AVLogger.debug('page.visible', { pageLeaving: this._pageLeaving });
      } else if (this._pageHidden) {
        AVLogger.debug('page.hidden');
      }
    };

    this._pageLeaveHandler = () => {
      this._pageLeaving = true;
      AVLogger.debug('page.leaving');
    };

    document.addEventListener('visibilitychange', this._visibilityHandler);
    window.addEventListener('pagehide', this._pageLeaveHandler);
    window.addEventListener('beforeunload', this._pageLeaveHandler);
  }

  private teardownPageVisibilityTracking(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
    if (this._pageLeaveHandler) {
      window.removeEventListener('pagehide', this._pageLeaveHandler);
      window.removeEventListener('beforeunload', this._pageLeaveHandler);
    }
  }
}
