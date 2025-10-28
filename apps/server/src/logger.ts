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

export const logger = {
  level: pinoLogger.level as LogLevel,
  debug: (...args: unknown[]) => pinoLogger.debug({ msg: args.map(String).join(' ') }),
  info: (...args: unknown[]) => pinoLogger.info({ msg: args.map(String).join(' ') }),
  warn: (...args: unknown[]) => pinoLogger.warn({ msg: args.map(String).join(' ') }),
  error: (...args: unknown[]) => pinoLogger.error({ msg: args.map(String).join(' ') }),
};


