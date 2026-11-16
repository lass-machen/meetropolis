import { logger } from '../../logger.js';
import { removeParticipantConfirmed } from './livekitRevocation.js';

/** Outcome of one privileged removal attempt. */
export type AvRemovalOutcome = 'removed' | 'absent' | 'failed';

/** Privileged removal; injected in tests, LiveKit in production. */
export type AvRemoveOperation = (roomName: string, identity: string) => Promise<AvRemovalOutcome>;

/** Confirmed-revocation backlog: retries failures, never grants access. */
export interface AvPendingBacklog {
  enqueue(roomName: string, identity: string): boolean;
  stop(): Promise<void>;
  pendingCount(): number;
}

export interface AvPendingOptions {
  remove: AvRemoveOperation;
  maxEntries?: number;
  maxConcurrent?: number;
  backoffMs?: number[];
  settleTimeoutMs?: number;
}

/** Process cap: room plus identity keys, duplicates merged. */
export const AV_PENDING_MAX_ENTRIES = 4096;
/** Privileged calls running at once. */
export const AV_PENDING_MAX_CONCURRENT = 4;
/** Retry gaps: 1, 2, 4, 8, 16 s, then the steady gap. */
export const AV_PENDING_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
/** Steady retry gap after the growing phase. */
export const AV_PENDING_STEADY_MS = 30_000;
/** Stop waits for running calls at most this long. */
export const AV_PENDING_SETTLE_MS = 5000;

interface BacklogEntry {
  key: string;
  roomName: string;
  identity: string;
  failures: number;
}

interface BacklogState {
  remove: AvRemoveOperation;
  maxEntries: number;
  maxConcurrent: number;
  backoffs: number[];
  steadyMs: number;
  settleMs: number;
  entries: Map<string, BacklogEntry>;
  waiters: Array<() => void>;
  sleepers: Set<() => void>;
  timers: Set<ReturnType<typeof setTimeout>>;
  inflight: Set<Promise<void>>;
  running: number;
  stopped: boolean;
  dropped: number;
}

function backoffFor(backoffs: number[], steadyMs: number, failures: number): number {
  if (failures < backoffs.length) return backoffs[failures];
  return steadyMs;
}

/** A slot frees the next waiter (handoff) or decrements the counter. */
function releaseSlot(state: BacklogState): void {
  const next = state.waiters.shift();
  if (next) {
    next();
    return;
  }
  state.running -= 1;
}

/** False when the backlog stopped while waiting; the caller then exits. */
function acquireSlot(state: BacklogState): Promise<boolean> {
  if (state.stopped) return Promise.resolve(false);
  if (state.running < state.maxConcurrent) {
    state.running += 1;
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    state.waiters.push(() => resolve(!state.stopped));
  });
}

/** Wakeable sleep; stop clears the timer and wakes every sleeper at once. */
function sleepMs(state: BacklogState, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const wake = (): void => {
      state.sleepers.delete(wake);
      state.timers.delete(timer);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    timer.unref();
    state.timers.add(timer);
    state.sleepers.add(wake);
  });
}

async function runEntry(state: BacklogState, entry: BacklogEntry): Promise<void> {
  for (;;) {
    if (state.stopped || !state.entries.has(entry.key)) return;
    const admitted = await acquireSlot(state);
    if (!admitted || state.stopped || !state.entries.has(entry.key)) {
      if (admitted) releaseSlot(state);
      return;
    }
    let outcome: AvRemovalOutcome;
    try {
      outcome = await state.remove(entry.roomName, entry.identity);
    } catch {
      outcome = 'failed';
    } finally {
      releaseSlot(state);
    }
    if (outcome === 'removed' || outcome === 'absent') {
      state.entries.delete(entry.key);
      return;
    }
    const gap = backoffFor(state.backoffs, state.steadyMs, entry.failures);
    entry.failures += 1;
    await sleepMs(state, gap);
  }
}

function enqueueInto(state: BacklogState, roomName: string, identity: string): boolean {
  if (state.stopped) return false;
  const key = JSON.stringify([roomName, identity]);
  if (state.entries.has(key)) return true;
  if (state.entries.size >= state.maxEntries) {
    state.dropped += 1;
    logger.warn({ event: 'av.revocation_overflow', dropped: state.dropped });
    return false;
  }
  const entry: BacklogEntry = { key, roomName, identity, failures: 0 };
  state.entries.set(key, entry);
  const task = runEntry(state, entry);
  state.inflight.add(task);
  void task.then(() => {
    state.inflight.delete(task);
  });
  return true;
}

async function stopBacklog(state: BacklogState): Promise<void> {
  state.stopped = true;
  for (const timer of state.timers) clearTimeout(timer);
  state.timers.clear();
  for (const wake of [...state.waiters]) wake();
  state.waiters.length = 0;
  for (const wake of [...state.sleepers]) wake();
  state.sleepers.clear();
  state.entries.clear();
  if (state.inflight.size === 0) return;
  const settle = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, state.settleMs);
    timer.unref();
  });
  await Promise.race([Promise.allSettled([...state.inflight]), settle]);
}

/**
 * Backlog with an injected removal operation. The production instance uses
 * the confirmed LiveKit removal; tests inject a stub and fake timers.
 */
export function createAvPendingRevocations(options: AvPendingOptions): AvPendingBacklog {
  const state: BacklogState = {
    remove: options.remove,
    maxEntries: options.maxEntries ?? AV_PENDING_MAX_ENTRIES,
    maxConcurrent: options.maxConcurrent ?? AV_PENDING_MAX_CONCURRENT,
    backoffs: options.backoffMs ?? AV_PENDING_BACKOFF_MS,
    steadyMs: AV_PENDING_STEADY_MS,
    settleMs: options.settleTimeoutMs ?? AV_PENDING_SETTLE_MS,
    entries: new Map(),
    waiters: [],
    sleepers: new Set(),
    timers: new Set(),
    inflight: new Set(),
    running: 0,
    stopped: false,
    dropped: 0,
  };
  return {
    enqueue: (roomName, identity) => enqueueInto(state, roomName, identity),
    stop: () => stopBacklog(state),
    pendingCount: () => state.entries.size,
  };
}

type BacklogPhase = 'idle' | 'running' | 'stopped';

let phase: BacklogPhase = 'idle';
let singleton: AvPendingBacklog | null = null;

function hasLivekitConfig(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

/**
 * Begin (or keep) the process backlog epoch. Creates a backlog only from
 * `idle` or `stopped`, never discards a running one, and ends `running`.
 */
export function ensureAvPendingRevocations(): void {
  if (phase === 'running' && singleton) return;
  singleton = createAvPendingRevocations({ remove: removeParticipantConfirmed });
  phase = 'running';
}

/** Entries currently held by the process backlog (0 without a backlog). */
export function avPendingCount(): number {
  return singleton ? singleton.pendingCount() : 0;
}

/**
 * Queue a confirmed removal through the process backlog. Lazily starts the
 * backlog from `idle` so revocations before the reconciler boot are kept;
 * after the stop nothing is accepted. Without LiveKit coordinates nothing is
 * accepted either, so no endless retry builds up. Returns false when the
 * entry was dropped or the backlog overflows; the periodic reconciler picks
 * the participant up again. Never grants access.
 */
export function enqueueAvRevocation(roomName: string, identity: string): boolean {
  if (phase === 'stopped') {
    logger.debug({ event: 'av.revocation_dropped', reason: 'backlog_stopped' });
    return false;
  }
  if (!hasLivekitConfig()) {
    logger.debug({ event: 'av.revocation_dropped', reason: 'not_configured' });
    return false;
  }
  ensureAvPendingRevocations();
  return singleton ? singleton.enqueue(roomName, identity) : false;
}

/**
 * Drop every timer and entry, await running calls briefly, accept nothing
 * more. A restart loses the entries like a real process exit; the next
 * reconciler round rediscovers the participants.
 */
export async function stopAvPendingRevocations(): Promise<void> {
  phase = 'stopped';
  const current = singleton;
  singleton = null;
  if (current) await current.stop();
}
