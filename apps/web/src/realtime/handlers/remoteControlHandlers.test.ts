/**
 * Unit tests for sanitizeBroadcastPayload: the client-side backstop for the
 * fan-out remote-control paths. It must keep only protective (device-off)
 * actions and drop every activating (`true`) value as well as `dnd`
 * entirely, so a hostile broadcast can never enable a local device or lift
 * DND on this client.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeBroadcastPayload } from './remoteControlHandlers';

describe('sanitizeBroadcastPayload', () => {
  it('passes through protective (false) mic/cam/share values', () => {
    expect(sanitizeBroadcastPayload({ mic: false, cam: false, share: false })).toEqual({
      mic: false,
      cam: false,
      share: false,
    });
  });

  it('drops activating (true) values', () => {
    expect(sanitizeBroadcastPayload({ mic: true, cam: true, share: true })).toEqual({});
  });

  it('keeps the false field and drops the true field in a mixed payload', () => {
    expect(sanitizeBroadcastPayload({ mic: false, cam: true })).toEqual({ mic: false });
  });

  it('drops dnd regardless of value', () => {
    expect(sanitizeBroadcastPayload({ dnd: false })).toEqual({});
    expect(sanitizeBroadcastPayload({ dnd: true })).toEqual({});
    expect(sanitizeBroadcastPayload({ mic: false, dnd: false })).toEqual({ mic: false });
  });

  it('returns an empty object for undefined or empty input', () => {
    expect(sanitizeBroadcastPayload(undefined)).toEqual({});
    expect(sanitizeBroadcastPayload({})).toEqual({});
  });
});
