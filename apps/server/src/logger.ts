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

function isObjectArg(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// An Error keeps message and stack in non-enumerable own properties, so
// spreading it into the record dropped everything that identifies it.
function serializeError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) out.code = error.code;
  if (error.stack) out.stack = error.stack;
  return out;
}

// Plain objects are merged into the record; Error instances land under
// `err` (pino's convention), as an array when a call passes several.
function mergeArgs(record: Record<string, unknown>, values: unknown[]): Record<string, unknown> {
  const errors: Record<string, unknown>[] = [];
  for (const value of values) {
    if (value instanceof Error) errors.push(serializeError(value));
    else if (isObjectArg(value)) Object.assign(record, value);
  }
  if (errors.length > 0) record.err = errors.length === 1 ? errors[0] : errors;
  return record;
}

export function asRecord(args: unknown[]): Record<string, unknown> | null {
  if (args.length === 0) return null;
  const [first, ...rest] = args;
  // If first is an object, merge others if objects
  if (isObjectArg(first)) return mergeArgs({}, args);
  // If first is string and second is object -> include msg + context
  if (typeof first === 'string' && rest.length > 0 && isObjectArg(rest[0])) {
    const obj = mergeArgs({}, rest);
    obj.msg = first;
    return obj;
  }
  // Fallback: join to msg
  const record = {
    msg: args
      .filter((a) => !(a instanceof Error))
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' '),
  };
  return mergeArgs(
    record,
    args.filter((a) => a instanceof Error),
  );
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
