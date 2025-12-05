/**
 * Structured logging for the AV system.
 *
 * All logs are prefixed with [AV] and include structured metadata.
 * Debug logs are throttled to prevent console flooding.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  identity?: string;
  roomName?: string;
  correlationId?: string;
}

export interface LogEntry {
  level: LogLevel;
  event: string;
  message: string | undefined;
  data: Record<string, unknown> | undefined;
  context: LogContext | undefined;
  timestamp: number;
}

// Throttle debug logs to prevent flooding
const debugThrottleMs = 500;
const lastDebugTime: Map<string, number> = new Map();

// Check if we're in development mode
const isDev = (): boolean => {
  try {
    const env = (import.meta as any).env;
    return !!env?.DEV || env?.MODE === 'development';
  } catch {
    return false;
  }
};

// Check if debug is explicitly enabled
const isDebugEnabled = (): boolean => {
  try {
    const env = (import.meta as any).env;
    if (env?.VITE_AV_DEBUG === 'true') return true;
    if (typeof window !== 'undefined' && (window as any).__avDebugOn) return true;
    return false;
  } catch {
    return false;
  }
};

class AVLoggerImpl {
  private context: LogContext = {};
  private enabled = true;

  setContext(ctx: Partial<LogContext>): void {
    this.context = { ...this.context, ...ctx };
  }

  clearContext(): void {
    this.context = {};
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  debug(event: string, data?: Record<string, unknown>, message?: string): void {
    if (!this.enabled) return;
    if (!isDev() && !isDebugEnabled()) return;

    // Throttle debug logs by event type
    const now = Date.now();
    const lastTime = lastDebugTime.get(event) || 0;
    if (now - lastTime < debugThrottleMs) return;
    lastDebugTime.set(event, now);

    this.log('debug', event, data, message);
  }

  info(event: string, data?: Record<string, unknown>, message?: string): void {
    if (!this.enabled) return;
    this.log('info', event, data, message);
  }

  warn(event: string, data?: Record<string, unknown>, message?: string): void {
    if (!this.enabled) return;
    this.log('warn', event, data, message);
  }

  error(event: string, data?: Record<string, unknown>, message?: string): void {
    if (!this.enabled) return;
    this.log('error', event, data, message);
  }

  private log(level: LogLevel, event: string, data?: Record<string, unknown>, message?: string): void {
    const entry: LogEntry = {
      level,
      event,
      message,
      data,
      context: { ...this.context },
      timestamp: Date.now(),
    };

    const prefix = `[AV][${level}]`;
    const eventStr = `[${event}]`;
    const contextStr = this.context.identity ? `[${this.context.identity}]` : '';
    const msgStr = message || '';

    const logFn = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : level === 'info' ? console.info
      : console.debug;

    if (data && Object.keys(data).length > 0) {
      logFn(`${prefix}${eventStr}${contextStr}`, msgStr, data);
    } else {
      logFn(`${prefix}${eventStr}${contextStr}`, msgStr);
    }

    // Store for later retrieval if needed
    this.storeEntry(entry);
  }

  private entries: LogEntry[] = [];
  private maxEntries = 1000;

  private storeEntry(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  getEntries(filter?: { level?: LogLevel; event?: string; since?: number }): LogEntry[] {
    let result = [...this.entries];

    if (filter?.level) {
      result = result.filter(e => e.level === filter.level);
    }
    if (filter?.event) {
      const eventFilter = filter.event;
      result = result.filter(e => e.event.includes(eventFilter));
    }
    if (filter?.since !== undefined) {
      const sinceTime = filter.since;
      result = result.filter(e => e.timestamp >= sinceTime);
    }

    return result;
  }

  clearEntries(): void {
    this.entries = [];
  }

  /**
   * Create a child logger with additional context
   */
  child(ctx: Partial<LogContext>): AVLoggerImpl {
    const child = new AVLoggerImpl();
    child.context = { ...this.context, ...ctx };
    child.enabled = this.enabled;
    return child;
  }
}

// Singleton instance
export const AVLogger = new AVLoggerImpl();

// Helper to build correlation headers for API calls
export function buildCorrelationHeaders(ctx: LogContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (ctx.correlationId) {
    headers['X-Correlation-ID'] = ctx.correlationId;
  }
  if (ctx.identity) {
    headers['X-AV-Identity'] = ctx.identity;
  }
  if (ctx.roomName) {
    headers['X-AV-Room'] = ctx.roomName;
  }
  return headers;
}

// Install global debug toggle
if (typeof window !== 'undefined') {
  try {
    if (!(window as any).__avLoggerInstalled) {
      (window as any).__avLoggerInstalled = true;
      (window as any).avLogger = AVLogger;

      window.addEventListener('keydown', (e) => {
        if ((e.altKey || (e.ctrlKey && e.shiftKey)) && e.key.toLowerCase() === 'd') {
          const w = window as any;
          w.__avDebugOn = !w.__avDebugOn;
          console.info(`[AV] Debug mode: ${w.__avDebugOn ? 'ON' : 'OFF'}`);
        }
      }, true);
    }
  } catch {
    // Ignore errors in non-browser environments
  }
}
