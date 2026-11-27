import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Runs the shipped worklet module the way an AudioWorkletGlobalScope does:
 * `AudioWorkletProcessor`, `registerProcessor` and `sampleRate` are globals of
 * the scope, the module registers its class and the engine calls `process()`
 * once per 128-frame render quantum.
 *
 * Guards the defect behind silent microphones: `process()` declared a local
 * `const sampleRate = sampleRate`, which throws a ReferenceError (temporal
 * dead zone) on every call. The engine then fires `processorerror` and the
 * node outputs silence for the rest of its life, so every client on the
 * voice-isolation path published a silent track.
 */

const QUANTUM = 128;
const SAMPLE_RATE = 48_000;

type ProcessFn = (
  inputs: Float32Array[][],
  outputs: Float32Array[][],
  parameters: Record<string, Float32Array>,
) => boolean;

interface ProcessorInstance {
  process: ProcessFn;
}

type ProcessorCtor = (new () => ProcessorInstance) & {
  parameterDescriptors: { name: string; defaultValue: number }[];
};

// `npm test` runs vitest from apps/web; `import.meta.url` is no file URL in
// the jsdom environment, so the path is taken from the cwd.
const WORKLET_SOURCE = readFileSync(resolve(process.cwd(), 'src/av/audio/worklets/rnnoise-processor.js'), 'utf8');

function loadProcessor(): ProcessorCtor {
  const registered = new Map<string, ProcessorCtor>();
  runInNewContext(WORKLET_SOURCE, {
    AudioWorkletProcessor: class {},
    registerProcessor: (name: string, ctor: ProcessorCtor) => registered.set(name, ctor),
    sampleRate: SAMPLE_RATE,
  });
  const ctor = registered.get('rnnoise-processor');
  if (!ctor) throw new Error('rnnoise-processor was not registered');
  return ctor;
}

/** k-rate parameter arrays with the values voiceIsolation.ts sets on the node. */
function voiceIsolationParameters(): Record<string, Float32Array> {
  return {
    threshold: Float32Array.of(-56),
    ratio: Float32Array.of(0.25),
    attackMs: Float32Array.of(10),
    releaseMs: Float32Array.of(100),
    makeupGainDb: Float32Array.of(0),
  };
}

function sineQuantum(amplitude: number, offset: number): Float32Array {
  const data = new Float32Array(QUANTUM);
  for (let i = 0; i < QUANTUM; i++) {
    data[i] = amplitude * Math.sin((2 * Math.PI * 440 * (offset + i)) / SAMPLE_RATE);
  }
  return data;
}

function energy(data: Float32Array): number {
  let sum = 0;
  for (const s of data) sum += s * s;
  return sum;
}

/** Feeds `quanta` render quanta of a 440 Hz sine and returns the energy ratio of the last one. */
function runSine(amplitude: number, quanta: number): number {
  const Processor = loadProcessor();
  const processor = new Processor();
  const parameters = voiceIsolationParameters();
  let ratio = 0;
  for (let q = 0; q < quanta; q++) {
    const input = sineQuantum(amplitude, q * QUANTUM);
    const output = new Float32Array(QUANTUM);
    expect(processor.process([[input]], [[output]], parameters)).toBe(true);
    ratio = energy(output) / energy(input);
  }
  return ratio;
}

describe('rnnoise-processor worklet (noise gate)', () => {
  it('registers the processor with its k-rate parameters', () => {
    const names = loadProcessor().parameterDescriptors.map((d) => d.name);
    expect(names).toEqual(['threshold', 'ratio', 'attackMs', 'releaseMs', 'makeupGainDb']);
  });

  it('passes speech-level input through without throwing', () => {
    // -20 dBFS peak is far above the -56 dB threshold: the gate stays open.
    expect(runSine(0.1, 50)).toBeGreaterThan(0.95);
  });

  it('attenuates input below the threshold but does not mute it', () => {
    // About -83 dBFS RMS: 27 dB under the threshold. The expander gain does not
    // settle within 400 quanta: the release coefficient is per sample but is
    // applied once per render quantum, so closing takes ~10 s of audio. Measured
    // energy ratio here is 0.9467; it converges to ~0.444 after ~30 000 quanta.
    const ratio = runSine(0.0001, 400);
    expect(ratio).toBeLessThan(0.95);
    expect(ratio).toBeGreaterThan(0);
  });

  it('keeps going when a quantum carries no input channels', () => {
    const processor = new (loadProcessor())();
    expect(processor.process([[]], [[new Float32Array(QUANTUM)]], voiceIsolationParameters())).toBe(true);
  });
});
