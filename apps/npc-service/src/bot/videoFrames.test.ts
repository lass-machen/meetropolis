import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeVideoFrames, fitVideoSize, probeVideoSize } from './videoFrames.js';

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

let tmp = '';
let large = '';
let small = '';
let notVideo = '';
let missing = '';

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'npc-video-'));
  large = join(tmp, 'large.mp4');
  small = join(tmp, 'small.mp4');
  notVideo = join(tmp, 'not-video.txt');
  missing = join(tmp, 'missing.mp4');
  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1920x1080:rate=30:duration=1',
    '-pix_fmt',
    'yuv420p',
    large,
  ]);
  await runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=30:duration=1',
    '-pix_fmt',
    'yuv420p',
    small,
  ]);
  await writeFile(notVideo, 'not a video');
}, 60000);

afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('videoFrames', () => {
  it('fits video sizes into the maximum bounds', () => {
    expect(fitVideoSize(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(fitVideoSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(fitVideoSize(1080, 1920)).toEqual({ width: 404, height: 720 });
    expect(fitVideoSize(641, 481)).toEqual({ width: 640, height: 480 });
    expect(() => fitVideoSize(0, 100)).toThrow();
    expect(() => fitVideoSize(NaN, 100)).toThrow();
  });

  it('probes video dimensions', async () => {
    await expect(probeVideoSize(large)).resolves.toEqual({ width: 1920, height: 1080 });
    await expect(probeVideoSize(missing)).rejects.toThrow();
    await expect(probeVideoSize(notVideo)).rejects.toThrow();
  });

  it('decodes raw I420 frames with independent buffers', async () => {
    const frames: Uint8Array[] = [];
    for await (const frame of decodeVideoFrames(small, { width: 320, height: 240 })) {
      frames.push(frame);
    }
    expect(frames.length).toBeGreaterThanOrEqual(13);
    expect(frames.length).toBeLessThanOrEqual(17);
    for (const frame of frames) {
      expect(frame.length).toBe(115200);
      expect(frame.byteOffset).toBe(0);
    }
    expect(frames[0]?.buffer).not.toBe(frames[1]?.buffer);
  });

  it('stops decoding when the abort signal fires', async () => {
    const controller = new AbortController();
    const frames: Uint8Array[] = [];
    for await (const frame of decodeVideoFrames(small, {
      width: 320,
      height: 240,
      loop: true,
      signal: controller.signal,
    })) {
      frames.push(frame);
      if (frames.length === 3) {
        controller.abort();
      }
    }
    expect(frames.length).toBeGreaterThanOrEqual(3);
  }, 15000);

  it('stops the ffmpeg process when the consumer breaks early', async () => {
    const frames: Uint8Array[] = [];
    for await (const frame of decodeVideoFrames(small, { width: 320, height: 240, loop: true })) {
      frames.push(frame);
      if (frames.length === 2) {
        break;
      }
    }
    expect(frames.length).toBe(2);
  });

  it('rejects when ffmpeg cannot decode the input', async () => {
    const frames: Uint8Array[] = [];
    const decode = (async () => {
      for await (const frame of decodeVideoFrames(notVideo, { width: 320, height: 240 })) {
        frames.push(frame);
      }
    })();
    await expect(decode).rejects.toThrow(/ffmpeg exited with code/);
  });
});
