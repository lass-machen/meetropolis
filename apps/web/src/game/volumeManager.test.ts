import { describe, it, expect, vi } from 'vitest';
import { computePairVolume, outsideBubbleAttenuationFromDb, VolumeManager, type Polygon } from './volumeManager';

const square = (x: number, y: number, w: number, name: string): Polygon => ({
  name,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + w },
    { x, y: y + w },
  ],
});

describe('computePairVolume', () => {
  const rules = { nearRadius: 100, farRadius: 300, outsideBubbleAttenuation: 0.2 };
  const zones = [square(0, 0, 200, 'A'), square(300, 0, 200, 'B')];

  it('is full volume inside same zone', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      new Set(),
      rules,
    );
    expect(v).toBe(1);
  });

  it('attenuates by distance outside zones', () => {
    const vNear = computePairVolume(
      { id: 'me', x: 250, y: 250 },
      { id: 'u1', x: 300, y: 250 },
      zones,
      null,
      new Set(),
      rules,
    );
    const vFar = computePairVolume(
      { id: 'me', x: 250, y: 250 },
      { id: 'u1', x: 600, y: 250 },
      zones,
      null,
      new Set(),
      rules,
    );
    expect(vNear).toBeGreaterThan(0.9);
    expect(vFar).toBe(0);
  });

  it('bubble members hear full volume', () => {
    const v = computePairVolume(
      // Both participants outside any zone.
      { id: 'me', x: 250, y: 250 },
      { id: 'u2', x: 260, y: 260 },
      zones,
      null,
      new Set(['me', 'u2']),
      rules,
    );
    expect(v).toBe(1);
  });

  it('bubble vs outside attenuates strongly', () => {
    const v1 = computePairVolume(
      { id: 'me', x: 10, y: 10 },
      { id: 'out', x: 12, y: 12 },
      zones,
      null,
      new Set(['me']),
      rules,
    );
    const v2 = computePairVolume(
      { id: 'me', x: 10, y: 10 },
      { id: 'out', x: 12, y: 12 },
      zones,
      null,
      new Set(['out']),
      rules,
    );
    expect(v1).toBeCloseTo(0.2, 5);
    expect(v2).toBeCloseTo(0.2, 5);
  });

  it('mutes when local is in a zone and remote is outside', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 }, // in zone A
      { id: 'u', x: 250, y: 250 }, // outside
      zones,
      null,
      new Set(),
      rules,
    );
    expect(v).toBe(0);
  });

  it('mutes when both are in different zones', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 }, // in zone A
      { id: 'u', x: 350, y: 50 }, // in zone B
      zones,
      null,
      new Set(),
      rules,
    );
    expect(v).toBe(0);
  });

  it('follow target is always full volume', () => {
    const v = computePairVolume({ id: 'me', x: 0, y: 0 }, { id: 'u', x: 2000, y: 2000 }, zones, 'u', new Set(), rules);
    expect(v).toBe(1);
  });

  it('is full volume for same bubble group inside the same zone', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      { me: 'g1', u1: 'g1' },
      rules,
    );
    expect(v).toBe(1);
  });

  it('mutes distinct bubble groups inside the same zone by default', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      { me: 'g1', u1: 'g2' },
      rules,
    );
    expect(v).toBe(0);
  });

  it('attenuates distinct bubble groups when differentBubbleMute is disabled', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      { me: 'g1', u1: 'g2' },
      { ...rules, differentBubbleMute: false },
    );
    expect(v).toBeCloseTo(rules.outsideBubbleAttenuation, 5);
  });

  it('attenuates bubble-vs-outside pairs inside the same zone', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 },
      { id: 'u1', x: 150, y: 150 },
      zones,
      null,
      { me: 'g1' },
      rules,
    );
    expect(v).toBeCloseTo(rules.outsideBubbleAttenuation, 5);
  });

  it('zone isolation wins over shared bubble membership across zones', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 }, // in zone A
      { id: 'u1', x: 350, y: 50 }, // in zone B
      zones,
      null,
      { me: 'g1', u1: 'g1' },
      rules,
    );
    expect(v).toBe(0);
  });

  it('zone isolation wins over shared bubble membership when remote is outside', () => {
    const v = computePairVolume(
      { id: 'me', x: 50, y: 50 }, // in zone A
      { id: 'u1', x: 250, y: 250 }, // outside any zone
      zones,
      null,
      { me: 'g1', u1: 'g1' },
      rules,
    );
    expect(v).toBe(0);
  });

  it('is full volume without zones and without bubbles at close distance', () => {
    const v = computePairVolume({ id: 'me', x: 250, y: 250 }, { id: 'u1', x: 260, y: 260 }, [], null, {}, rules);
    expect(v).toBe(1);
  });
});

describe('outsideBubbleAttenuationFromDb', () => {
  it('keeps the fallback when unset', () => {
    expect(outsideBubbleAttenuationFromDb(undefined, 0.05)).toBe(0.05);
    expect(outsideBubbleAttenuationFromDb('', 0.05)).toBe(0.05);
  });

  it('keeps the fallback for non-numeric input', () => {
    expect(outsideBubbleAttenuationFromDb('abc', 0.05)).toBe(0.05);
  });

  it('converts dB to linear gain', () => {
    expect(outsideBubbleAttenuationFromDb('-12', 0.05)).toBeCloseTo(0.2512, 3);
    expect(outsideBubbleAttenuationFromDb('0', 0.05)).toBe(1);
  });

  it('clamps to the [0, 1] gain range', () => {
    expect(outsideBubbleAttenuationFromDb('12', 0.05)).toBe(1);
    expect(outsideBubbleAttenuationFromDb('-200', 0.05)).toBeLessThan(1e-9);
  });
});

describe('VolumeManager.update', () => {
  const zones = [square(0, 0, 200, 'A'), square(300, 0, 200, 'B')];

  function makeManager(opts: {
    remotes: Record<string, { x: number; y: number }>;
    bubbleGroups?: Record<string, string>;
    dnd?: boolean;
  }) {
    const setParticipantVolume = vi.fn();
    const manager = new VolumeManager(
      { setParticipantVolume },
      {
        getLocal: () => ({ id: 'me', x: 50, y: 50 }),
        getRemotes: () => opts.remotes,
        getZones: () => zones,
        getFollowTarget: () => null,
        getBubbleGroups: () => opts.bubbleGroups ?? {},
        getLocalDnd: () => !!opts.dnd,
      },
    );
    return { manager, setParticipantVolume };
  }

  it('applies zone-aware volumes per remote', () => {
    const { manager, setParticipantVolume } = makeManager({
      remotes: {
        sameZone: { x: 150, y: 150 },
        otherZone: { x: 350, y: 50 },
        outside: { x: 250, y: 250 },
      },
    });
    const volumes = manager.update();
    expect(volumes).toEqual({ sameZone: 1, otherZone: 0, outside: 0 });
    expect(setParticipantVolume).toHaveBeenCalledWith('sameZone', 1);
    expect(setParticipantVolume).toHaveBeenCalledWith('otherZone', 0);
    expect(setParticipantVolume).toHaveBeenCalledWith('outside', 0);
  });

  it('mutes everyone while local DND is active', () => {
    const { manager, setParticipantVolume } = makeManager({
      remotes: { sameZone: { x: 150, y: 150 } },
      dnd: true,
    });
    expect(manager.update()).toEqual({});
    expect(setParticipantVolume).toHaveBeenCalledWith('sameZone', 0);
  });
});
