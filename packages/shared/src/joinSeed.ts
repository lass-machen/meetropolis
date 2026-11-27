/**
 * Join-seed handshake: the client announces after registering its one-shot
 * message handlers that it is ready to receive the initial full_state,
 * bubble_state, zone_lock_state and presence_recent payloads. The join
 * option `joinSeedProtocol` advertises this capability; older clients omit
 * it and keep the legacy delayed send.
 */
export const JOIN_SEED_PROTOCOL_VERSION = 1;

/** Colyseus message type the client sends once its handlers are registered. */
export const JOIN_SEED_READY_MESSAGE = 'join_seed_ready';
