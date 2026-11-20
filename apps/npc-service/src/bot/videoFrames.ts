import { spawn } from 'node:child_process';

/** Maximum width of a decoded video frame in pixels. */
export const VIDEO_MAX_WIDTH = 1280;
/** Maximum height of a decoded video frame in pixels. */
export const VIDEO_MAX_HEIGHT = 720;
/** Default frame rate for decoded video in frames per second. */
export const VIDEO_FPS = 15;

/** Width and height of a video in pixels. */
export interface VideoSize {
  width: number;
  height: number;
}

/** Scale a video size down to fit within the maximum bounds, never up. */
export function fitVideoSize(width: number, height: number): VideoSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid video size: ${width}x${height}`);
  }
  const factor = Math.min(1, VIDEO_MAX_WIDTH / width, VIDEO_MAX_HEIGHT / height);
  const scaledWidth = Math.floor(width * factor);
  const scaledHeight = Math.floor(height * factor);
  return {
    width: Math.max(2, scaledWidth - (scaledWidth % 2)),
    height: Math.max(2, scaledHeight - (scaledHeight % 2)),
  };
}

/** Probe the width and height of the first video stream in a file. */
export function probeVideoSize(filePath: string): Promise<VideoSize> {
  return new Promise<VideoSize>((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0:s=x',
      filePath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      const firstLine = stdout.split('\n')[0] ?? '';
      const match = /^(\d+)x(\d+)/.exec(firstLine);
      if (!match) {
        reject(new Error(`no video stream in ${filePath}`));
        return;
      }
      resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
  });
}

/** Options for decoding raw video frames. */
export interface VideoFrameOptions {
  width: number;
  height: number;
  fps?: number;
  loop?: boolean;
  signal?: AbortSignal;
}

/** Decode a video file into raw I420 frames of the given size. */
export async function* decodeVideoFrames(filePath: string, options: VideoFrameOptions): AsyncGenerator<Uint8Array> {
  const fps = options.fps ?? VIDEO_FPS;
  const frameBytes = (options.width * options.height * 3) / 2;
  const proc = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      ...(options.loop ? ['-stream_loop', '-1'] : []),
      '-i',
      filePath,
      '-an',
      '-vf',
      `scale=${options.width}:${options.height},fps=${fps}`,
      '-pix_fmt',
      'yuv420p',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal },
  );
  const outcome: { code: number | null; error: Error | null } = { code: null, error: null };
  let stderrTail = '';
  const ended = new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      outcome.code = code;
      resolve();
    });
    proc.on('error', (error) => {
      outcome.error = error;
      resolve();
    });
  });
  proc.stderr?.on('data', (chunk) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-500);
  });
  try {
    let buffer = Buffer.alloc(0);
    for await (const chunk of proc.stdout ?? []) {
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      let start = 0;
      while (start + frameBytes <= buffer.length) {
        // Copy each frame: @livekit/rtc-node VideoFrame reads data.buffer from offset 0,
        // so every yielded frame needs its own ArrayBuffer.
        yield new Uint8Array(buffer.subarray(start, start + frameBytes));
        start += frameBytes;
      }
      buffer = buffer.subarray(start);
    }
    await ended;
    if (options.signal?.aborted) {
      return;
    }
    if (outcome.error) {
      throw new Error(`ffmpeg failed to start: ${outcome.error.message}`);
    }
    if (outcome.code !== 0) {
      throw new Error(`ffmpeg exited with code ${outcome.code}: ${stderrTail.trim()}`);
    }
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL');
    }
  }
}
