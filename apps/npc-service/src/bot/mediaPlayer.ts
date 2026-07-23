import fs from 'fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { logger } from '../index.js';

export interface AudioFrame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

// WAV header constants
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // 'RIFF'
const PCM_FORMAT = 1;
const EXPECTED_BITS_PER_SAMPLE = 16;
const STANDARD_DATA_OFFSET = 44;
const BYTES_PER_SAMPLE_16BIT = 2;

/**
 * Parse WAV file and yield PCM frames
 */
export async function* parseWavFrames(filePath: string, frameDurationMs: number = 20): AsyncGenerator<AudioFrame> {
  const buf = await fs.promises.readFile(filePath);

  validateRiffHeader(buf);
  const { channels, sampleRate } = parseFmtChunk(buf);
  const dataSize = buf.readUInt32LE(40);

  const samplesPerFrame = Math.floor((sampleRate * frameDurationMs) / 1000);
  const bytesPerFrame = samplesPerFrame * channels * BYTES_PER_SAMPLE_16BIT;

  let offset = STANDARD_DATA_OFFSET;
  const endOffset = STANDARD_DATA_OFFSET + dataSize;

  while (offset + bytesPerFrame <= endOffset) {
    const frameData = new Int16Array(buf.buffer, buf.byteOffset + offset, samplesPerFrame * channels);
    yield {
      data: frameData,
      sampleRate,
      channels,
      samplesPerChannel: samplesPerFrame,
    };
    offset += bytesPerFrame;
  }
}

function validateRiffHeader(buf: Buffer): void {
  for (let i = 0; i < RIFF_MAGIC.length; i++) {
    if (buf[i] !== RIFF_MAGIC[i]) {
      throw new Error('Not a valid WAV file');
    }
  }
}

function parseFmtChunk(buf: Buffer): { channels: number; sampleRate: number } {
  const audioFormat = buf.readUInt16LE(20);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  if (audioFormat !== PCM_FORMAT) {
    throw new Error(`Unsupported audio format: ${audioFormat} (expected PCM)`);
  }
  if (bitsPerSample !== EXPECTED_BITS_PER_SAMPLE) {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample} (expected 16)`);
  }
  return { channels, sampleRate };
}

/**
 * Transcode non-WAV audio to raw PCM via FFmpeg
 */
export function transcodeToPcm(
  filePath: string,
  sampleRate: number = 48000,
  channels: number = 1,
): AsyncGenerator<Buffer> {
  const proc: ChildProcessWithoutNullStreams = spawn(
    'ffmpeg',
    ['-i', filePath, '-f', 's16le', '-ar', String(sampleRate), '-ac', String(channels), 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  proc.stderr.on('data', (data: Buffer) => {
    logger.debug(`[FFmpeg] ${data.toString()}`);
  });

  async function* generate(): AsyncGenerator<Buffer> {
    for await (const chunk of proc.stdout) {
      yield chunk as Buffer;
    }
  }

  return generate();
}
