import type { Client } from '@colyseus/core';
import { JOIN_SEED_PROTOCOL_VERSION } from '@meetropolis/shared';
import { logger } from '../../logger.js';
import type { RoomOptions } from '../WorldRoom.js';

// Wait until the client's onMessage handlers are likely registered before
// sending one-shot messages. Colyseus 0.17 resolves joinOrCreate faster than
// 0.15, which exposed a pre-existing race: the server raced the client's
// setupPlayerHandlers() and triggered "@colyseus/sdk: onMessage() not
// registered for type 'full_state'/'bubble_state'/'presence_recent'" warnings,
// so the client never received the initial state and the roster stayed empty.
// Legacy fallback only: clients that announce joinSeedProtocol use the ready
// handshake instead of this delay.
const HANDLER_REGISTRATION_DELAY_MS = 200;

const seeds = new WeakMap<Client, { ready: boolean; pending: Array<() => void> }>();

// Keep an early ready that arrives before openJoinSeed; a second ready stays a no-op.
export function openJoinSeed(client: Client, options: RoomOptions): void {
  if (typeof options?.joinSeedProtocol === 'number' && options.joinSeedProtocol >= JOIN_SEED_PROTOCOL_VERSION) {
    const existing = seeds.get(client);
    if (existing?.ready) {
      return;
    }
    seeds.set(client, { ready: false, pending: [] });
  } else {
    seeds.delete(client);
  }
}

export function deliverJoinSeed(client: Client, send: () => void): void {
  const entry = seeds.get(client);
  if (!entry) {
    setTimeout(send, HANDLER_REGISTRATION_DELAY_MS);
    return;
  }
  if (entry.ready) {
    send();
    return;
  }
  entry.pending.push(send);
}

export function markJoinSeedReady(client: Client): void {
  const entry = seeds.get(client);
  if (!entry) {
    seeds.set(client, { ready: true, pending: [] });
    return;
  }
  if (entry.ready) {
    logger.debug('[joinSeed] markJoinSeedReady ignored (already ready)');
    return;
  }
  entry.ready = true;
  const pending = entry.pending.splice(0, entry.pending.length);
  for (const send of pending) {
    try {
      send();
    } catch (e) {
      logger.debug('[joinSeed] Failed to deliver pending join seed', e);
    }
  }
}
