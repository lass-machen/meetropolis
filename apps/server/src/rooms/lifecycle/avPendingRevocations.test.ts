import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AV_PENDING_MAX_ENTRIES,
  createAvPendingRevocations,
  type AvPendingBacklog,
  type AvRemovalOutcome,
} from './avPendingRevocations.js';

const created: AvPendingBacklog[] = [];

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function track(stub: () => Promise<AvRemovalOutcome>): { calls: number[]; remove: () => Promise<AvRemovalOutcome> } {
  const calls: number[] = [];
  return {
    calls,
    remove: async () => {
      calls.push(calls.length + 1);
      return stub();
    },
  };
}

function failing(): { calls: number[]; remove: () => Promise<AvRemovalOutcome> } {
  return track(() => Promise.resolve('failed'));
}

async function stopAll(): Promise<void> {
  while (created.length > 0) {
    const next = created.pop() as AvPendingBacklog;
    await next.stop();
  }
}

type BacklogModule = typeof import('./avPendingRevocations.js');

async function freshBacklogModule(): Promise<BacklogModule> {
  vi.resetModules();
  return import('./avPendingRevocations.js');
}

const LIVEKIT_ENV_KEYS = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;

/** Unreachable SFU coordinates so the singleton attempt fails fast and stays queued. */
function setDummyLivekitEnv(): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of LIVEKIT_ENV_KEYS) {
    previous.set(key, process.env[key]);
    process.env[key] = key === 'LIVEKIT_URL' ? 'http://127.0.0.1:9' : `test-${key.toLowerCase()}`;
  }
  return () => {
    for (const key of LIVEKIT_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function stopFresh(fresh: BacklogModule): Promise<void> {
  const stopping = fresh.stopAvPendingRevocations();
  await vi.advanceTimersByTimeAsync(5000);
  await stopping;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await stopAll();
  vi.useRealTimers();
});

describe('av pending revocations', () => {
  it('drops the entry after a confirmed removal', async () => {
    const { remove } = track(() => Promise.resolve('removed'));
    const backlog = createAvPendingRevocations({ remove });
    created.push(backlog);
    expect(backlog.enqueue('slug:world', 'user-a')).toBe(true);
    await flush();
    expect(backlog.pendingCount()).toBe(0);
  });

  it('drops the entry when the participant is already absent', async () => {
    const { remove } = track(() => Promise.resolve('absent'));
    const backlog = createAvPendingRevocations({ remove });
    created.push(backlog);
    expect(backlog.enqueue('slug:world', 'user-a')).toBe(true);
    await flush();
    expect(backlog.pendingCount()).toBe(0);
  });

  it('merges duplicate entries for one room and identity', async () => {
    const tracked = failing();
    const backlog = createAvPendingRevocations({ remove: tracked.remove });
    created.push(backlog);
    expect(backlog.enqueue('slug:world', 'user-a')).toBe(true);
    expect(backlog.enqueue('slug:world', 'user-a')).toBe(true);
    await flush();
    expect(tracked.calls.length).toBe(1);
    expect(backlog.pendingCount()).toBe(1);
  });

  it('retries a failure with growing gaps', async () => {
    const tracked = failing();
    const backlog = createAvPendingRevocations({ remove: tracked.remove });
    created.push(backlog);
    backlog.enqueue('slug:world', 'user-a');
    await flush();
    expect(tracked.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tracked.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(tracked.calls.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tracked.calls.length).toBe(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(tracked.calls.length).toBe(4);
    await vi.advanceTimersByTimeAsync(8000);
    expect(tracked.calls.length).toBe(5);
    await vi.advanceTimersByTimeAsync(16000);
    expect(tracked.calls.length).toBe(6);
  });

  it('caps the steady gap at thirty seconds', async () => {
    const tracked = failing();
    const backlog = createAvPendingRevocations({ remove: tracked.remove });
    created.push(backlog);
    backlog.enqueue('slug:world', 'user-a');
    await flush();
    for (const gap of [1000, 2000, 4000, 8000, 16000, 30000]) {
      await vi.advanceTimersByTimeAsync(gap);
    }
    expect(tracked.calls.length).toBe(7);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(tracked.calls.length).toBe(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(tracked.calls.length).toBe(8);
  });

  it('rejects new entries past the cap and keeps the rest', async () => {
    const tracked = failing();
    const backlog = createAvPendingRevocations({ remove: tracked.remove, maxEntries: 2 });
    created.push(backlog);
    expect(backlog.enqueue('slug:world', 'user-a')).toBe(true);
    expect(backlog.enqueue('slug:world', 'user-b')).toBe(true);
    expect(backlog.enqueue('slug:world', 'user-c')).toBe(false);
    expect(backlog.pendingCount()).toBe(2);
    expect(AV_PENDING_MAX_ENTRIES).toBe(4096);
  });

  it('runs at most four removals at once', async () => {
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const backlog = createAvPendingRevocations({
      remove: () =>
        new Promise<AvRemovalOutcome>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          release.push(() => {
            active -= 1;
            resolve('removed');
          });
        }),
    });
    created.push(backlog);
    for (let index = 0; index < 6; index += 1) backlog.enqueue('slug:world', `user-${index}`);
    await flush();
    expect(peak).toBe(4);
    while (release.length > 0) (release.shift() as () => void)();
    await flush();
    while (release.length > 0) (release.shift() as () => void)();
    await flush();
    expect(backlog.pendingCount()).toBe(0);
  });

  it('accepts nothing after stop and keeps no timers', async () => {
    const tracked = failing();
    const backlog = createAvPendingRevocations({ remove: tracked.remove });
    created.push(backlog);
    backlog.enqueue('slug:world', 'user-a');
    await flush();
    await backlog.stop();
    expect(backlog.enqueue('slug:world', 'user-b')).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tracked.calls.length).toBe(1);
  });

  it('enqueue before any start is kept and processed', async () => {
    const restoreEnv = setDummyLivekitEnv();
    try {
      const fresh = await freshBacklogModule();
      expect(fresh.enqueueAvRevocation('slug:world', 'user-a')).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(fresh.avPendingCount()).toBe(1);
      await stopFresh(fresh);
      expect(fresh.avPendingCount()).toBe(0);
    } finally {
      restoreEnv();
    }
  });

  it('start does not discard a running backlog', async () => {
    const restoreEnv = setDummyLivekitEnv();
    try {
      const fresh = await freshBacklogModule();
      expect(fresh.enqueueAvRevocation('slug:world', 'user-a')).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(fresh.avPendingCount()).toBe(1);
      fresh.ensureAvPendingRevocations();
      expect(fresh.avPendingCount()).toBe(1);
      expect(fresh.enqueueAvRevocation('slug:world', 'user-b')).toBe(true);
      expect(fresh.avPendingCount()).toBe(2);
      await stopFresh(fresh);
    } finally {
      restoreEnv();
    }
  });
});
