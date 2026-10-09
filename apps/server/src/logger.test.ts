import { describe, expect, it } from 'vitest';
import { asRecord } from './logger.js';

class CodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}

describe('logger asRecord', () => {
  it('serializes an Error passed after a message instead of spreading it', () => {
    const error = new Error('livekit unreachable');

    expect(asRecord(['[AudioZones] reconcile failed', error])).toEqual({
      msg: '[AudioZones] reconcile failed',
      err: { name: 'Error', message: 'livekit unreachable', stack: error.stack },
    });
  });

  it('keeps a code the error carries', () => {
    const error = new CodedError('participant does not exist', 'not_found');

    expect(asRecord(['update failed', error])).toEqual({
      msg: 'update failed',
      err: { name: 'CodedError', message: 'participant does not exist', code: 'not_found', stack: error.stack },
    });
  });

  it('serializes an Error passed as the only argument', () => {
    const error = new TypeError('bad input');

    expect(asRecord([error])).toEqual({ err: { name: 'TypeError', message: 'bad input', stack: error.stack } });
  });

  it('keeps the context object and the error when both follow the message', () => {
    const error = new Error('boom');

    expect(asRecord(['publish failed', { room: 'acme:world', identity: 'user-1' }, error])).toEqual({
      msg: 'publish failed',
      room: 'acme:world',
      identity: 'user-1',
      err: { name: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('merges an Error after a leading context object', () => {
    const error = new Error('boom');

    expect(asRecord([{ event: 'x.failed' }, error])).toEqual({
      event: 'x.failed',
      err: { name: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('collects several errors into an array', () => {
    const first = new Error('first');
    const second = new Error('second');

    expect(asRecord([{ event: 'x' }, first, second])).toEqual({
      event: 'x',
      err: [
        { name: 'Error', message: 'first', stack: first.stack },
        { name: 'Error', message: 'second', stack: second.stack },
      ],
    });
  });

  it('keeps an error in the joined-message fallback', () => {
    const error = new Error('boom');

    expect(asRecord(['retry', 'later', error])).toEqual({
      msg: 'retry later',
      err: { name: 'Error', message: 'boom', stack: error.stack },
    });
  });

  it('leaves plain context objects and messages as before', () => {
    expect(asRecord([{ event: 'a', n: 1 }, { m: 2 }])).toEqual({ event: 'a', n: 1, m: 2 });
    expect(asRecord(['hello', { a: 1 }])).toEqual({ msg: 'hello', a: 1 });
    expect(asRecord(['plain', 3])).toEqual({ msg: 'plain 3' });
    expect(asRecord([])).toBeNull();
  });
});
