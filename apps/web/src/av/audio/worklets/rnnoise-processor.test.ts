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
 *
 * The time-constant cases measure the gain trajectory sample by sample with
 * the parameters voiceIsolation.ts sets on the node. A constant (DC) input
 * makes `output[i] / input[i]` the exact gain applied to sample i.
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

// Vitest runs test files as ES modules on Node, so `import.meta.dirname` is
// this file's directory regardless of the cwd the runner was started from.
const WORKLET_SOURCE = readFileSync(resolve(import.meta.dirname, 'rnnoise-processor.js'), 'utf8');

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

// Values voiceIsolation.ts sets on the node (buildDenoiseGraph).
const VOICE_ISOLATION = { threshold: -56, ratio: 0.25, attackMs: 10, releaseMs: 100, makeupGainDb: 0 };

/** k-rate parameter arrays with the values voiceIsolation.ts sets on the node. */
function voiceIsolationParameters(): Record<string, Float32Array> {
  return Object.fromEntries(Object.entries(VOICE_ISOLATION).map(([name, value]) => [name, Float32Array.of(value)]));
}

/** Static expander gain the worklet targets for an input `distanceDb` below the threshold. */
function expectedTargetGain(distanceDb: number): number {
  return 1 - (1 - VOICE_ISOLATION.ratio) * (Math.min(60, distanceDb) / 60);
}

/** Per-sample smoothing coefficient for a time constant in ms. */
function coefficient(ms: number): number {
  return Math.exp(-1 / (0.001 * ms * SAMPLE_RATE));
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
  const processor = new (loadProcessor())();
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

interface DcOptions {
  channels?: number;
  parameters?: Record<string, Float32Array>;
  /** Frames per render quantum; the Web Audio default is 128. */
  quantum?: number;
}

/**
 * Feeds `quanta` quanta of constant `level` on identical channels and returns
 * the gain of every sample of channel 0.
 */
function runDc(processor: ProcessorInstance, level: number, quanta: number, options: DcOptions = {}): number[] {
  const { channels = 1, parameters = voiceIsolationParameters(), quantum = QUANTUM } = options;
  const gains: number[] = [];
  for (let q = 0; q < quanta; q++) {
    const inputs = Array.from({ length: channels }, () => new Float32Array(quantum).fill(level));
    const outputs = Array.from({ length: channels }, () => new Float32Array(quantum));
    expect(processor.process([inputs], [outputs], parameters)).toBe(true);
    for (const s of outputs[0]) gains.push(s / level);
  }
  return gains;
}

function last(values: number[]): number {
  return values[values.length - 1] ?? Number.NaN;
}

/**
 * Time constant in ms: time until the gain covered 1 - 1/e (63.2 %) of the
 * step from `start` to `target`, linearly interpolated between samples.
 */
function measuredTimeConstantMs(gains: number[], start: number, target: number): number {
  const mark = target + (start - target) / Math.E;
  const rising = target > start;
  let previous = start;
  for (let i = 0; i < gains.length; i++) {
    const g = gains[i];
    if (rising ? g >= mark : g <= mark) {
      const fraction = (mark - previous) / (g - previous);
      return ((i + fraction) / SAMPLE_RATE) * 1000;
    }
    previous = g;
  }
  return Number.POSITIVE_INFINITY;
}

// DC level 0.1 is -20 dBFS (far above the -56 dB threshold); 0.0001 is
// -80 dBFS, 24 dB under it.
const LOUD = 0.1;
const QUIET = 0.0001;
const QUIET_TARGET = expectedTargetGain(24);
// 1 s of audio: ten release time constants, enough to settle either way.
const SETTLE_QUANTA = Math.ceil(SAMPLE_RATE / QUANTUM);

describe('rnnoise-processor worklet (noise gate)', () => {
  it('registers the processor with its k-rate parameters', () => {
    const names = loadProcessor().parameterDescriptors.map((d) => d.name);
    expect(names).toEqual(['threshold', 'ratio', 'attackMs', 'releaseMs', 'makeupGainDb']);
  });

  it('passes speech-level input through without throwing', () => {
    // -20 dBFS peak is far above the -56 dB threshold: the gate stays open.
    expect(runSine(0.1, 50)).toBeGreaterThan(0.99);
  });

  it('settles below the threshold to the static expander gain within a second', () => {
    // About -83 dBFS RMS, 27 dB under the threshold: the energy ratio must
    // reach the squared static gain, attenuated but not muted.
    const rmsDb = 20 * Math.log10(0.0001 / Math.SQRT2);
    const settled = expectedTargetGain(VOICE_ISOLATION.threshold - rmsDb) ** 2;
    // 440 Hz does not fit a quantum in whole periods, so the per-quantum RMS
    // wobbles by a few tenths of a dB around the long-term value.
    const ratio = runSine(0.0001, SETTLE_QUANTA);
    expect(Math.abs(ratio - settled)).toBeLessThan(0.02);
  });

  it('closes with the configured release time constant (100 ms)', () => {
    const gains = runDc(new (loadProcessor())(), QUIET, SETTLE_QUANTA);
    const tau = measuredTimeConstantMs(gains, 1, QUIET_TARGET);
    expect(tau).toBeGreaterThan(VOICE_ISOLATION.releaseMs * 0.99);
    expect(tau).toBeLessThan(VOICE_ISOLATION.releaseMs * 1.01);
    expect(last(gains)).toBeCloseTo(QUIET_TARGET, 4);
  });

  it('opens with the configured attack time constant (10 ms)', () => {
    const processor = new (loadProcessor())();
    // Measure from the state the closed gate actually reached, not from the
    // ideal target it approaches asymptotically.
    const closed = last(runDc(processor, QUIET, SETTLE_QUANTA));
    expect(closed).toBeCloseTo(QUIET_TARGET, 4);
    const gains = runDc(processor, LOUD, SETTLE_QUANTA);
    const tau = measuredTimeConstantMs(gains, closed, 1);
    expect(tau).toBeGreaterThan(VOICE_ISOLATION.attackMs * 0.99);
    expect(tau).toBeLessThan(VOICE_ISOLATION.attackMs * 1.01);
    expect(last(gains)).toBeCloseTo(1, 6);
  });

  it('ramps the gain per sample instead of stepping it at quantum boundaries', () => {
    // A gain that is only updated once per quantum jumps at every boundary
    // (zipper noise). Per-sample smoothing never moves further in one sample
    // than the first sample of the step does.
    const processor = new (loadProcessor())();
    const closed = last(runDc(processor, QUIET, SETTLE_QUANTA));
    const gains = [closed, ...runDc(processor, LOUD, 20)];
    const firstStep = (1 - coefficient(VOICE_ISOLATION.attackMs)) * (1 - closed);
    let largest = 0;
    for (let i = 1; i < gains.length; i++) largest = Math.max(largest, gains[i] - gains[i - 1]);
    expect(largest).toBeLessThanOrEqual(firstStep * 1.0001);
  });

  it('keeps the time constants independent of the channel count', () => {
    const mono = runDc(new (loadProcessor())(), QUIET, 60, { channels: 1 });
    const stereo = runDc(new (loadProcessor())(), QUIET, 60, { channels: 2 });
    expect(stereo).toEqual(mono);
  });

  it.each([64, 256, 512])('keeps both time constants at a render quantum of %i frames', (quantum) => {
    // Chromium can run a context with a non-default render quantum size; the
    // smoother must not depend on it.
    const processor = new (loadProcessor())();
    const quanta = Math.ceil(SAMPLE_RATE / quantum);
    const release = runDc(processor, QUIET, quanta, { quantum });
    const closed = last(release);
    const attack = runDc(processor, LOUD, quanta, { quantum });
    expect(measuredTimeConstantMs(release, 1, QUIET_TARGET)).toBeCloseTo(VOICE_ISOLATION.releaseMs, 0);
    expect(measuredTimeConstantMs(attack, closed, 1)).toBeCloseTo(VOICE_ISOLATION.attackMs, 1);
  });

  it('falls back to the descriptor defaults when parameter arrays are missing', () => {
    const Processor = loadProcessor();
    const defaults = Object.fromEntries(
      Processor.parameterDescriptors.map((d) => [d.name, Float32Array.of(d.defaultValue)]),
    );
    const explicit = runDc(new Processor(), QUIET, 40, { parameters: defaults });
    const missing = runDc(new Processor(), QUIET, 40, { parameters: {} });
    // Float32 parameter arrays round the defaults (0.2), hence no exact match.
    const deviation = Math.max(...missing.map((g, i) => Math.abs(g - (explicit[i] ?? Number.NaN))));
    expect(deviation).toBeLessThan(1e-6);
  });

  it('keeps going when a quantum carries no input channels', () => {
    const processor = new (loadProcessor())();
    expect(processor.process([[]], [[new Float32Array(QUANTUM)]], voiceIsolationParameters())).toBe(true);
  });
});
