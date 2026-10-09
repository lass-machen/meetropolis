import { describe, expect, it } from 'vitest';
import { asRecord, createPinoLogger } from './logger.js';

class CodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}

// The record as pino writes it: pino's serialized error also holds a symbol
// reference to the raw error, which never reaches the output.
function logged(args: unknown[]): unknown {
  return JSON.parse(JSON.stringify(asRecord(args))) as unknown;
}

describe('logger asRecord', () => {
  it('serializes an Error passed after a message instead of spreading it', () => {
    const error = new Error('livekit unreachable');

    expect(logged(['[AudioZones] reconcile failed', error])).toEqual({
      msg: '[AudioZones] reconcile failed',
      err: { type: 'Error', message: 'livekit unreachable', stack: error.stack },
    });
  });

  it('keeps a code the error carries', () => {
    const error = new CodedError('participant does not exist', 'not_found');

    expect(logged(['update failed', error])).toEqual({
      msg: 'update failed',
      err: {
        type: 'CodedError',
        name: 'CodedError',
        message: 'participant does not exist',
        code: 'not_found',
        stack: error.stack,
      },
    });
  });

  it('serializes an Error passed as the only argument', () => {
    const error = new TypeError('bad input');

    expect(logged([error])).toEqual({ err: { type: 'TypeError', message: 'bad input', stack: error.stack } });
  });

  it('keeps the context object and the error when both follow the message', () => {
    const error = new Error('boom');

    expect(logged(['publish failed', { room: 'acme:world', identity: 'user-1' }, error])).toEqual({
      msg: 'publish failed',
      room: 'acme:world',
      identity: 'user-1',
      err: { type: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('merges an Error after a leading context object', () => {
    const error = new Error('boom');

    expect(logged([{ event: 'x.failed' }, error])).toEqual({
      event: 'x.failed',
      err: { type: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('collects several errors into an array', () => {
    const first = new Error('first');
    const second = new Error('second');

    expect(logged([{ event: 'x' }, first, second])).toEqual({
      event: 'x',
      err: [
        { type: 'Error', message: 'first', stack: first.stack },
        { type: 'Error', message: 'second', stack: second.stack },
      ],
    });
  });

  it('keeps an error in the joined-message fallback', () => {
    const error = new Error('boom');

    expect(logged(['retry', 'later', error])).toEqual({
      msg: 'retry later',
      err: { type: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('leaves plain context objects and messages as before', () => {
    expect(asRecord([{ event: 'a', n: 1 }, { m: 2 }])).toEqual({ event: 'a', n: 1, m: 2 });
    expect(asRecord(['hello', { a: 1 }])).toEqual({ msg: 'hello', a: 1 });
    expect(asRecord(['plain', 3])).toEqual({ msg: 'plain 3' });
    expect(asRecord([])).toBeNull();
  });
});

describe('logger output', () => {
  class PrismaLikeError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly meta: Record<string, unknown>,
      readonly clientVersion: string,
    ) {
      super(message);
    }
  }

  function captureLines(log: (logger: ReturnType<typeof createPinoLogger>) => void): Record<string, unknown>[] {
    const lines: string[] = [];
    log(createPinoLogger({ write: (line: string) => void lines.push(line) }));
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('writes a serialized error once, with its type and its enumerable fields', () => {
    const error = new PrismaLikeError('unique constraint failed', 'P2002', { target: ['slug'] }, '6.19.0');

    const [line] = captureLines((logger) => logger.warn(asRecord(['create failed', error])));

    expect(line?.err).toEqual({
      type: 'PrismaLikeError',
      message: 'unique constraint failed',
      stack: error.stack,
      code: 'P2002',
      meta: { target: ['slug'] },
      clientVersion: '6.19.0',
    });
  });

  it('serializes an Error a caller nests under err in a context object', () => {
    const error = new TypeError('bad input');

    const [line] = captureLines((logger) => logger.warn(asRecord([{ err: error, sessionId: 's1' }, 'join failed'])));

    expect(line).toMatchObject({ sessionId: 's1', err: { type: 'TypeError', message: 'bad input' } });
  });
});
