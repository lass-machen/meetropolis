import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

function resolveLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const pinoLogger = pino({
  level: resolveLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'meetropolis-server' },
});

function asRecord(args: unknown[]): Record<string, unknown> | null {
  if (args.length === 0) return null;
  const [first, ...rest] = args;
  // If first is an object, merge others if objects
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const base = { ...(first as Record<string, unknown>) };
    for (const r of rest) {
      if (r && typeof r === 'object' && !Array.isArray(r)) Object.assign(base, r as Record<string, unknown>);
    }
    return base;
  }
  // If first is string and second is object -> include msg + context
  if (typeof first === 'string' && rest.length > 0 && rest[0] && typeof rest[0] === 'object') {
    const obj: Record<string, unknown> = { ...(rest[0] as Record<string, unknown>) };
    obj.msg = first;
    return obj;
  }
  // Fallback: join to msg
  return { msg: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') };
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
  const record = asRecord(args);
  if (record === null) return;
  pinoLogger[level](record);
}

export const logger = {
  level: pinoLogger.level as LogLevel,
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
