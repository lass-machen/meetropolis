import { describe, it, expect } from 'vitest';
import {
  DEPTH_BACKGROUND,
  DEPTH_GROUND,
  DEPTH_WALLS,
  DEPTH_FLOOR_OBJECT,
  normalizeRenderLayer,
  overheadDepth,
  editorOverlayDepth,
  borderDepth,
  gridDepth,
  objectFootDepth,
  actorFootDepth,
} from './depthConstants';

describe('depthConstants: foot lines', () => {
  it('objectFootDepth is the bottom edge of a top-left-origin object', () => {
    // plant at tileY row 3 (48px), 48px tall (3 tiles) -> foot at 96
    expect(objectFootDepth(48, 48)).toBe(96);
  });
  it('actorFootDepth is the bottom edge of a center-origin actor', () => {
    // avatar centered at y=100, 24px tall -> foot at 112
    expect(actorFootDepth(100, 24)).toBe(112);
  });
});

describe('depthConstants: render-layer bands never collide with actors', () => {
  const mapH = 640; // office: 40 tiles * 16px

  it('overhead is always above any actor foot line within the map', () => {
    const deepestActor = actorFootDepth(mapH, 24); // an actor at the very bottom
    // even an overhead object at the top of the map outranks the deepest actor
    expect(overheadDepth(0, mapH)).toBeGreaterThan(deepestActor);
    // overhead still y-sorts among itself
    expect(overheadDepth(200, mapH)).toBeGreaterThan(overheadDepth(100, mapH));
  });

  it('floor objects are below the sort band, above the wall/ground layers', () => {
    expect(DEPTH_FLOOR_OBJECT).toBeLessThan(0); // below actors/furniture (>= 0)
    expect(DEPTH_FLOOR_OBJECT).toBeGreaterThan(DEPTH_WALLS);
    expect(DEPTH_WALLS).toBeGreaterThan(DEPTH_GROUND);
    expect(DEPTH_GROUND).toBeGreaterThan(DEPTH_BACKGROUND);
  });

  it('overlay bands are strictly ordered above the sort band', () => {
    const overheadMax = overheadDepth(mapH, mapH);
    expect(editorOverlayDepth(mapH)).toBeGreaterThan(overheadMax);
    expect(borderDepth(mapH)).toBeGreaterThan(editorOverlayDepth(mapH));
    expect(gridDepth(mapH)).toBeGreaterThan(borderDepth(mapH));
  });

  it('bands scale with map height so a tall map cannot overrun them', () => {
    const tall = 200000; // ~12500 tiles
    const deepestActor = actorFootDepth(tall, 24);
    expect(overheadDepth(0, tall)).toBeGreaterThan(deepestActor);
    expect(gridDepth(tall)).toBeGreaterThan(borderDepth(tall));
  });
});

describe('normalizeRenderLayer', () => {
  it('passes through the two explicit layers', () => {
    expect(normalizeRenderLayer('floor')).toBe('floor');
    expect(normalizeRenderLayer('overhead')).toBe('overhead');
  });
  it('defaults anything else (incl. undefined / legacy) to sorted', () => {
    expect(normalizeRenderLayer('sorted')).toBe('sorted');
    expect(normalizeRenderLayer(undefined)).toBe('sorted');
    expect(normalizeRenderLayer('objects')).toBe('sorted');
    expect(normalizeRenderLayer(42)).toBe('sorted');
  });
});
