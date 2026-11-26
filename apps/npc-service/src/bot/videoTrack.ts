import type * as RtcNode from '@livekit/rtc-node';
import { decodeVideoFrames, fitVideoSize, probeVideoSize, VIDEO_FPS } from './videoFrames.js';

/** Playback controls for a published video file. */
export interface VideoPlayback {
  stop: () => Promise<void>;
  done: Promise<void>;
}

/** Options for publishing a video file as a LiveKit track. */
export interface VideoTrackOptions {
  source: RtcNode.TrackSource;
  trackName: string;
  loop?: boolean;
}

/** Runs the given async function at most once, returning the same promise. */
function once(fn: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) pending = fn();
    return pending;
  };
}

/** Publishes a video file as a LiveKit video track, frame by frame. */
export async function startVideoTrack(
  lk: typeof RtcNode,
  participant: RtcNode.LocalParticipant,
  filePath: string,
  options: VideoTrackOptions,
): Promise<VideoPlayback> {
  const probed = await probeVideoSize(filePath);
  const size = fitVideoSize(probed.width, probed.height);
  const videoSource = new lk.VideoSource(size.width, size.height);
  const track = lk.LocalVideoTrack.createVideoTrack(options.trackName, videoSource);
  const publication = await participant
    .publishTrack(track, new lk.TrackPublishOptions({ source: options.source }))
    .catch(async (err: unknown) => {
      try {
        await videoSource.close();
      } catch {
        /* already gone */
      }
      throw err;
    });
  const cleanup = once(async () => {
    try {
      if (publication.sid) await participant.unpublishTrack(publication.sid);
    } catch {
      /* already gone */
    }
    try {
      await videoSource.close();
    } catch {
      /* already gone */
    }
  });
  const controller = new AbortController();
  const done: Promise<void> = (async () => {
    try {
      let index = 0;
      for await (const data of decodeVideoFrames(filePath, {
        ...size,
        fps: VIDEO_FPS,
        loop: options.loop,
        signal: controller.signal,
      })) {
        const frame = new lk.VideoFrame(data, size.width, size.height, lk.VideoBufferType.I420);
        videoSource.captureFrame(frame, BigInt(Math.round((index * 1_000_000) / VIDEO_FPS)));
        index += 1;
      }
    } finally {
      await cleanup();
    }
  })();
  const stop = async (): Promise<void> => {
    controller.abort();
    await done.catch(() => undefined);
  };
  return { stop, done };
}
