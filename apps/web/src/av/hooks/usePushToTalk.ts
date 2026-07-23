import { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import type { AVManager } from '../avManager';

interface UsePushToTalkParams {
  enabled: boolean;
  pttKey: string;
  isDnd: boolean;
  avRef: React.MutableRefObject<AVManager | null>;
}

function getAudioTrack(avRef: React.MutableRefObject<AVManager | null>) {
  const room = avRef.current?.room;
  if (!room) return null;
  for (const pub of room.localParticipant.trackPublications.values()) {
    if (pub.track?.source === Track.Source.Microphone && pub.track.mediaStreamTrack) {
      return pub.track.mediaStreamTrack;
    }
  }
  return null;
}

export function usePushToTalk({ enabled, pttKey, isDnd, avRef }: UsePushToTalkParams) {
  const isPressedRef = useRef(false);

  // Mute on enable, restore on disable
  useEffect(() => {
    if (isDnd) return;
    const track = getAudioTrack(avRef);
    if (!track) return;
    if (enabled) {
      track.enabled = false;
    } else {
      track.enabled = true;
    }
    return () => {
      isPressedRef.current = false;
    };
  }, [enabled, isDnd, avRef]);

  useEffect(() => {
    if (!enabled || isDnd) return;

    const isInputElement = (target: EventTarget | null): boolean => {
      if (!target) return false;
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target as HTMLElement).isContentEditable === true
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isPressedRef.current) return;
      if (e.code !== pttKey && e.key !== pttKey) return;
      if (isInputElement(e.target)) return;
      isPressedRef.current = true;
      const track = getAudioTrack(avRef);
      if (track) track.enabled = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey && e.key !== pttKey) return;
      isPressedRef.current = false;
      const track = getAudioTrack(avRef);
      if (track) track.enabled = false;
    };

    const onSafety = () => {
      isPressedRef.current = false;
      const track = getAudioTrack(avRef);
      if (track) track.enabled = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onSafety);
    document.addEventListener('visibilitychange', onSafety);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onSafety);
      document.removeEventListener('visibilitychange', onSafety);
      isPressedRef.current = false;
    };
  }, [enabled, pttKey, isDnd, avRef]);
}
