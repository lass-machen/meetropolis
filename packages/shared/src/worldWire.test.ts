import { describe, it, expect } from 'vitest';
import { MIN_WORLD_WIRE_PROTOCOL_VERSION, WORLD_WIRE_PROTOCOL_VERSION } from './worldWire.js';

describe('world wire protocol version', () => {
  it('reports whole numbers', () => {
    expect(Number.isInteger(WORLD_WIRE_PROTOCOL_VERSION)).toBe(true);
    expect(Number.isInteger(MIN_WORLD_WIRE_PROTOCOL_VERSION)).toBe(true);
  });

  it('is accepted by the server minimum, or the current client would lock itself out', () => {
    expect(WORLD_WIRE_PROTOCOL_VERSION).toBeGreaterThanOrEqual(MIN_WORLD_WIRE_PROTOCOL_VERSION);
  });

  it('keeps out the Colyseus 0.17 generation, which sends no wire version', () => {
    // A client that sends nothing is treated as version 1 or older.
    expect(MIN_WORLD_WIRE_PROTOCOL_VERSION).toBeGreaterThanOrEqual(2);
  });
});
