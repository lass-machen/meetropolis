import { describe, it, expect } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  normalizeWheelDelta,
  pinchZoom,
  resolveWheelAction,
  stepZoom,
} from './overlayZoom';

describe('clampZoom', () => {
  it('keeps values inside the zoom bounds', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
  });
});

describe('stepZoom', () => {
  it('steps up and down by a quarter', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
  });

  it('clamps at the bounds', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('rounds float artifacts to two decimals', () => {
    expect(stepZoom(1.1, 1)).toBe(1.35);
    expect(stepZoom(0.3, -1)).toBe(MIN_ZOOM);
  });
});

describe('normalizeWheelDelta', () => {
  it('passes pixel deltas through', () => {
    expect(normalizeWheelDelta(3, 0)).toBe(3);
    expect(normalizeWheelDelta(-7, 0)).toBe(-7);
  });

  it('scales line deltas to pixels', () => {
    expect(normalizeWheelDelta(3, 1)).toBe(48);
  });

  it('scales page deltas to pixels', () => {
    expect(normalizeWheelDelta(-2, 2)).toBe(-200);
  });
});

describe('pinchZoom', () => {
  it('zooms in on negative deltaY and out on positive deltaY', () => {
    expect(pinchZoom(1, -100)).toBeGreaterThan(1);
    expect(pinchZoom(1, 100)).toBeLessThan(1);
  });

  it('is multiplicative and dampened', () => {
    expect(pinchZoom(1, -100)).toBeCloseTo(Math.exp(0.2), 10);
    expect(pinchZoom(2, -100)).toBeCloseTo(2 * Math.exp(0.2), 10);
  });

  it('accumulates fine deltas instead of ignoring them', () => {
    let zoom = 1;
    for (let i = 0; i < 50; i++) zoom = pinchZoom(zoom, -2);
    expect(zoom).toBeCloseTo(Math.exp(0.2), 10);
  });

  it('clamps at the zoom bounds', () => {
    expect(pinchZoom(1, -10000)).toBe(MAX_ZOOM);
    expect(pinchZoom(1, 10000)).toBe(MIN_ZOOM);
  });

  it('keeps the zoom unchanged for zero delta', () => {
    expect(pinchZoom(1.5, 0)).toBe(1.5);
  });
});

describe('clampPan', () => {
  const stage = { width: 800, height: 600 };

  it('forces the pan to the origin at zoom <= 1', () => {
    expect(clampPan({ x: 120, y: -80 }, 1, stage)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: 120, y: -80 }, 0.5, stage)).toEqual({ x: 0, y: 0 });
  });

  it('passes offsets inside the bounds through', () => {
    expect(clampPan({ x: 100, y: -50 }, 2, stage)).toEqual({ x: 100, y: -50 });
  });

  it('clamps offsets to half of the overflowing size per axis', () => {
    expect(clampPan({ x: 9999, y: -9999 }, 2, stage)).toEqual({ x: 400, y: -300 });
    expect(clampPan({ x: -9999, y: 9999 }, 1.5, stage)).toEqual({ x: -200, y: 150 });
  });
});

describe('resolveWheelAction', () => {
  const base = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, deltaMode: 0 };

  it('zooms on ctrl+wheel (macOS pinch) regardless of the zoom level', () => {
    const action = resolveWheelAction({ ...base, ctrlKey: true, deltaY: -100 }, 1);
    expect(action).toEqual({ kind: 'zoom', zoom: pinchZoom(1, -100) });
  });

  it('zooms on meta+wheel', () => {
    const action = resolveWheelAction({ ...base, metaKey: true, deltaY: 50 }, 2);
    expect(action).toEqual({ kind: 'zoom', zoom: pinchZoom(2, 50) });
  });

  it('normalizes line deltas before zooming', () => {
    const action = resolveWheelAction({ ...base, ctrlKey: true, deltaY: -3, deltaMode: 1 }, 1);
    expect(action).toEqual({ kind: 'zoom', zoom: pinchZoom(1, -48) });
  });

  it('ignores plain scrolling when not zoomed in', () => {
    expect(resolveWheelAction({ ...base, deltaY: -3 }, 1)).toEqual({ kind: 'none' });
    expect(resolveWheelAction({ ...base, deltaY: 3 }, 0.5)).toEqual({ kind: 'none' });
  });

  it('pans with inverted deltas when zoomed in', () => {
    const action = resolveWheelAction({ ...base, deltaX: 10, deltaY: -40 }, 2);
    expect(action).toEqual({ kind: 'pan', deltaX: -10, deltaY: 40 });
  });
});
