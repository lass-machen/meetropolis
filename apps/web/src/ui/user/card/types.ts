import type { RemoteParticipant, LocalParticipant, Participant } from 'livekit-client';

// The participant tile view model lives in one place; re-exported here so the
// card modules keep importing their types from a single local barrel.
export type { UiParticipant } from '../../../types/participant';

export type AnyParticipant = (Participant | RemoteParticipant | LocalParticipant) & { name?: string };
