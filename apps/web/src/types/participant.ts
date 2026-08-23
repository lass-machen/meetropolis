/**
 * View model for one tile in the participant UI.
 *
 * A tile is not the same thing as a LiveKit participant. A publisher that
 * shares its screen owns two tiles (`media: 'camera'` and `media: 'screen'`),
 * and a participant who is present in the Colyseus world but has no LiveKit
 * session owns a tile with no publisher behind it at all.
 *
 * The two name-ish fields are therefore deliberately separate:
 *
 * - `displayName` is what the user reads. It comes from the
 *   `profile name || e-mail || user id` cascade and is NOT unique: two guests
 *   without a profile name end up with the same string.
 * - `livekitIdentity` is the key of `Room.remoteParticipants` (the SDK
 *   documents that map as `identity -> RemoteParticipant`) and the only handle
 *   that is both unique and stable across reconnects. It is the empty string
 *   while no identity is KNOWN for the tile — not while no publisher exists. A
 *   presence-only `col:` tile from the Colyseus roster carries the identity as
 *   soon as the Colyseus-to-LiveKit mapping has one
 *   (`features/participants/useParticipants.ts`), and there is still no LiveKit
 *   participant of this room behind it. A non-empty `livekitIdentity` is
 *   therefore no evidence of a publisher.
 *
 * Resolving a tile back to its publisher goes through `livekitIdentity`, never
 * through `displayName` — a name match attaches one participant's camera to
 * another participant's tile as soon as the names collide. The single authority
 * on whether a publisher exists at all is `ui/user/card/participantUtils.ts`
 * `findParticipant`: it either returns a participant of the current room or
 * null, and only its answer may be acted on (see `performForceMute` there).
 *
 * This is the single declaration of the shape. Every layer between the
 * producer (`features/participants/useParticipants.ts`) and the consumer
 * (`ui/user/card/`) imports it instead of restating it; the restated copies
 * are what let `livekitIdentity` go missing in the first place.
 */
export type UiParticipant = {
  /** Tile id. The publisher SID, suffixed with ':screen' for a screen tile, or a synthetic 'local' / 'col:<id>' id for a tile without a publisher. */
  sid: string;
  /** LiveKit participant identity, or '' when no identity is known for the tile. Non-empty does not imply a publisher. */
  livekitIdentity: string;
  /** Human-readable label. Not unique, never a lookup key. */
  displayName: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
  dnd?: boolean;
  avatarId?: string;
};
