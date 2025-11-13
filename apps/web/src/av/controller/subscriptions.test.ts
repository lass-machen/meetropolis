import { describe, it, expect } from 'vitest';
import { applySubscriptions } from './subscriptions';

function makeCtx(overrides: Partial<Parameters<typeof applySubscriptions>[0]> = {}) {
  const pub = (kind: 'audio' | 'video', source?: string) => ({ kind, track: { kind }, source });
  const participant = (identity: string) => ({ identity, trackPublications: new Map<string, any>() });
  const p1 = participant('a');
  p1.trackPublications.set('a1', pub('audio'));
  p1.trackPublications.set('v1', pub('video', 'camera'));
  const room: any = {
    state: 'connected',
    remoteParticipants: new Map<string, any>([
      ['a', p1],
    ]),
  };
  const calls: Array<{ id: string; kind: 'audio' | 'video'; should: boolean }> = [];
  const ctx = {
    room,
    isSignalOpen: () => true,
    dnd: false,
    desiredIds: ['a'],
    activeSpeakerIds: [],
    maxVideoSubs: 6,
    setDesired: (_pub: any, identity: string, kind: 'audio' | 'video', should: boolean) => calls.push({ id: identity, kind, should }),
    lastDesiredIdsKeyRef: { current: null as string | null },
    ...overrides,
  } as any;
  return { ctx, calls };
}

describe('applySubscriptions', () => {
  it('abonniert Audio immer (ohne DND)', () => {
    const { ctx, calls } = makeCtx();
    applySubscriptions(ctx);
    expect(calls.some((c) => c.kind === 'audio' && c.should)).toBe(true);
  });

  it('abonniert Video für wenige Teilnehmer standardmäßig', () => {
    const { ctx, calls } = makeCtx({ maxVideoSubs: 2 });
    applySubscriptions(ctx);
    expect(calls.some((c) => c.kind === 'video' && c.should)).toBe(true);
  });

  it('setzt keinen zweiten Durchlauf, wenn key gleich bleibt', () => {
    const { ctx, calls } = makeCtx();
    applySubscriptions(ctx);
    const first = calls.length;
    applySubscriptions(ctx);
    expect(calls.length).toBe(first);
  });

  it('abonniert nichts bei DND', () => {
    const { ctx, calls } = makeCtx({ dnd: true });
    applySubscriptions(ctx);
    expect(calls.length).toBe(0);
  });
});


