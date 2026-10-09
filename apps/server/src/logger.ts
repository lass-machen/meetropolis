import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

function resolveLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent') return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

// pino's default `err` serializer treats any object with a message as an
// error and would serialize the records asRecord already serialized a second
// time, as type "Object". Only Error instances still need it, such as one a
// caller nests in a context object.
function serializeErrField(value: unknown): unknown {
  return value instanceof Error ? pino.stdSerializers.err(value) : value;
}

export function createPinoLogger(destination?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: resolveLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'meetropolis-server' },
    serializers: { err: serializeErrField },
  };
  return destination ? pino(options, destination) : pino(options);
}

const pinoLogger = createPinoLogger();

function isObjectArg(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// An Error keeps message and stack in non-enumerable own properties, so
// spreading it into the record dropped everything that identifies it. pino's
// standard serializer keeps them, the constructor name as `type`, the causes,
// and the error's enumerable fields such as a code.
function serializeError(error: Error): pino.SerializedError {
  return pino.stdSerializers.err(error);
}

// Plain objects are merged into the record; Error instances land under
// `err` (pino's convention), as an array when a call passes several.
function mergeArgs(record: Record<string, unknown>, values: unknown[]): Record<string, unknown> {
  const errors: pino.SerializedError[] = [];
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
