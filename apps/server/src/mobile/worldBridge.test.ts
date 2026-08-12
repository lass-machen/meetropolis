import { describe, it, expect } from 'vitest';
import { collectPlayers } from './worldBridge.js';

/** Minimal stand-in for the Colyseus `MapSchema` iteration contract. */
function stateWith(entries: Record<string, Record<string, unknown>>) {
  return {
    players: {
      forEach: (cb: (value: Record<string, unknown>, key: string) => void) => {
        for (const [key, value] of Object.entries(entries)) cb(value, key);
      },
    },
  };
}

describe('collectPlayers', () => {
  it('projects a player onto the flat mobile shape', () => {
    const players = collectPlayers(
      stateWith({
        'sess-1': {
          identity: 'user-1',
          name: 'Ada',
          x: 120,
          y: 80,
          dnd: true,
          avatarId: 'av-7',
          isNpc: false,
          mapId: 'map-1',
          mapName: 'Office',
        },
      }),
    );

    expect(players).toEqual([
      {
        id: 'sess-1',
        identity: 'user-1',
        name: 'Ada',
        x: 120,
        y: 80,
        dnd: true,
        avatarId: 'av-7',
        isNpc: false,
        mapId: 'map-1',
        mapName: 'Office',
      },
    ]);
  });

  it('falls back to the session key when a player carries no identity', () => {
    // The room assigns `identity` on join; a half-initialised entry must not
    // produce an undefined identity, because the app keys audio tracks on it.
    const players = collectPlayers(stateWith({ 'sess-2': {} }));
    expect(players[0].identity).toBe('sess-2');
    expect(players[0].name).toBe('');
    expect(players[0].dnd).toBe(false);
  });

  it('returns an empty list when the state carries no players map', () => {
    expect(collectPlayers({})).toEqual([]);
  });

  it('keeps NPCs in the roster and marks them', () => {
    // NPCs are part of presence; the app decides how to render them.
    const players = collectPlayers(stateWith({ npc: { identity: 'npc-bot', isNpc: true } }));
    expect(players[0].isNpc).toBe(true);
  });
});
