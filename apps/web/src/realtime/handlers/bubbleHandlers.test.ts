import { describe, it, expect, vi } from 'vitest';
import { setupBubbleHandlers } from './bubbleHandlers';
import { onBubbleMembersUpdate } from '../../lib/avEvents';
import type { UseWorldRoomArgs } from '../types';

interface MockMessageHandlers {
  [event: string]: (data: unknown) => void;
}

function makeMockRoom() {
  const handlers: MockMessageHandlers = {};
  return {
    onMessage: (event: string, cb: (data: unknown) => void) => {
      handlers[event] = cb;
    },
    trigger: (event: string, data?: unknown) => {
      handlers[event]?.(data);
    },
    send: vi.fn(),
  };
}

function makeRef<T>(initial: T) {
  return { current: initial };
}

function makeArgs(overrides?: Partial<UseWorldRoomArgs>): UseWorldRoomArgs {
  return {
    localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 0, y: 0 }),
    remotesRef: makeRef<Record<string, { x: number; y: number }>>({
      'session-a': { x: 10, y: 20 },
      'session-b': { x: 30, y: 40 },
    }),
    colyseusToLivekitMap: makeRef<Record<string, string>>({
      'session-local': 'local-user',
      'session-a': 'user-a',
      'session-b': 'user-b',
    }),
    identityToNameMap: makeRef<Record<string, string>>({ 'user-a': 'Alice', 'user-b': 'Bob' }),
    gameBridge: {
      setBubbleMembers: vi.fn(),
      setMovementLocked: vi.fn(),
    } as unknown as UseWorldRoomArgs['gameBridge'],
    bubbleMembersRef: makeRef<Set<string>>(new Set()),
    bubbleGroupsRef: makeRef<Record<string, string>>({}),
    setBubbleUi: vi.fn(),
    applyVolumesToUi: vi.fn(),
    ...overrides,
  } as unknown as UseWorldRoomArgs;
}

function captureEmittedBubbleIds(run: () => void): string[][] {
  const emitted: string[][] = [];
  const off = onBubbleMembersUpdate((ids) => emitted.push(ids));
  try {
    run();
  } finally {
    off();
  }
  return emitted;
}

describe('setupBubbleHandlers', () => {
  it('announces bubble members to the AV layer as LiveKit identities', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    setupBubbleHandlers(room as unknown as Parameters<typeof setupBubbleHandlers>[0], args);

    const emitted = captureEmittedBubbleIds(() => {
      room.trigger('bubble_state', {
        members: ['session-local', 'session-a'],
        groups: [{ id: 'g1', members: ['session-local', 'session-a'] }],
      });
    });

    // LiveKit identities only: no Colyseus session ids, no '__local__'.
    expect(emitted).toEqual([['user-a']]);
    expect(args.bubbleGroupsRef.current).toEqual({ 'session-local': 'g1', 'session-a': 'g1' });
    expect(args.applyVolumesToUi).toHaveBeenCalledTimes(1);

    // The visual set for the game layer keeps Colyseus ids plus '__local__'.
    const visual = (args.gameBridge.setBubbleMembers as ReturnType<typeof vi.fn>).mock.calls[0][0] as Set<string>;
    expect(visual.has('__local__')).toBe(true);
    expect(visual.has('session-a')).toBe(true);
  });

  it('filters members that are not on the same map before emitting', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    setupBubbleHandlers(room as unknown as Parameters<typeof setupBubbleHandlers>[0], args);

    const emitted = captureEmittedBubbleIds(() => {
      room.trigger('bubble_state', {
        members: ['session-local', 'session-a', 'session-ghost'],
        groups: [{ id: 'g1', members: ['session-local', 'session-a', 'session-ghost'] }],
      });
    });

    expect(emitted).toEqual([['user-a']]);
  });

  it('emits an empty list when the bubble dissolves', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    setupBubbleHandlers(room as unknown as Parameters<typeof setupBubbleHandlers>[0], args);

    const emitted = captureEmittedBubbleIds(() => {
      room.trigger('bubble_state', { members: [], groups: [] });
    });

    expect(emitted).toEqual([[]]);
    expect(args.bubbleGroupsRef.current).toEqual({});
  });
});
