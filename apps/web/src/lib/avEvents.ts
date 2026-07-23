const bus: EventTarget = typeof window !== 'undefined' ? window : new EventTarget();

export const EVT_BUBBLE = 'bubble-members-update';
export const EVT_AUDIO_TRACKS_CHANGED = 'av-audio-tracks-changed';

export function onBubbleMembersUpdate(handler: (ids: string[]) => void): () => void {
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<string[]>;
    const ids = Array.isArray(ce.detail) ? ce.detail : [];
    handler(ids);
  };
  bus.addEventListener(EVT_BUBBLE, wrapped);
  return () => bus.removeEventListener(EVT_BUBBLE, wrapped);
}

export function emitBubbleMembers(ids: string[]) {
  bus.dispatchEvent(new CustomEvent<string[]>(EVT_BUBBLE, { detail: ids }));
}

export function onAudioTracksChanged(handler: () => void): () => void {
  const wrapped = (_e: Event) => handler();
  bus.addEventListener(EVT_AUDIO_TRACKS_CHANGED, wrapped);
  return () => bus.removeEventListener(EVT_AUDIO_TRACKS_CHANGED, wrapped);
}

export function emitAudioTracksChanged(): void {
  bus.dispatchEvent(new Event(EVT_AUDIO_TRACKS_CHANGED));
}

export const EVT_SAME_MAP = 'same-map-identities-update';

export function emitSameMapIdentities(ids: string[]): void {
  bus.dispatchEvent(new CustomEvent<string[]>(EVT_SAME_MAP, { detail: ids }));
}

export function onSameMapIdentitiesUpdate(handler: (ids: string[]) => void): () => void {
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<string[]>;
    const ids = Array.isArray(ce.detail) ? ce.detail : [];
    handler(ids);
  };
  bus.addEventListener(EVT_SAME_MAP, wrapped);
  return () => bus.removeEventListener(EVT_SAME_MAP, wrapped);
}
