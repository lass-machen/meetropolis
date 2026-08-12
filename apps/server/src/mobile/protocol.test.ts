import { describe, it, expect } from 'vitest';
import { encodeSseEvent, type MobilePlayer } from './protocol.js';

/**
 * SSE framing is line-oriented, JSON is not: `JSON.stringify` escapes `\n` and
 * `\r` but leaves U+0085, U+2028 and U+2029 raw, and every line-based reader
 * treats those three as line terminators. A display name is user-controlled
 * and travels in every roster frame, so one user with such a character in
 * their name would break every frame for every mobile client in the room.
 */

function player(name: string): MobilePlayer {
  return {
    id: 'sess-1',
    identity: 'user-2',
    name,
    x: 0,
    y: 0,
    dnd: false,
    avatarId: 'av-1',
    isNpc: false,
    mapId: 'map-1',
    mapName: 'Office',
  };
}

const RAW_TERMINATORS = ['\u0085', '\u2028', '\u2029'];

describe('encodeSseEvent', () => {
  it('keeps a frame on one line for every raw line terminator', () => {
    for (const char of RAW_TERMINATORS) {
      const frame = encodeSseEvent({ type: 'roster', players: [player(`A${char}B`)] });
      const body = frame.slice(0, -2); // drop the terminating blank line
      expect(body.split(/[\n\r\u0085\u2028\u2029]/)).toHaveLength(1);
    }
  });

  it('escapes without changing the decoded payload', () => {
    for (const char of RAW_TERMINATORS) {
      const frame = encodeSseEvent({ type: 'roster', players: [player(`A${char}B`)] });
      const decoded = JSON.parse(frame.slice('data: '.length)) as { players: MobilePlayer[] };
      expect(decoded.players[0].name).toBe(`A${char}B`);
    }
  });

  it('still frames an ordinary event as one data line plus a blank line', () => {
    const frame = encodeSseEvent({ type: 'zone_permissions', islandId: 'map-1:zone:kitchen', allow: ['user-2'] });
    expect(frame.startsWith('data: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.slice(0, -2).includes('\n')).toBe(false);
  });
});
