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
 * The worklet highpasses its input before the gain, so `output / input` is
 * not the applied gain. The time-constant cases read the per-sample gain the
 * processor exposes as `gainCurve` after every `process()` call instead.
 * They feed a 375 Hz sine: at 48 kHz that is exactly one period per
 * 128-frame quantum, a whole number of periods at 256 and 512 frames and half
 * a period at 64, so the RMS the gate detects per quantum stays constant.
 */

const QUANTUM = 128;
const SAMPLE_RATE = 48_000;
const TONE_HZ = 375;

type ProcessFn = (
  inputs: Float32Array[][],
  outputs: Float32Array[][],
  parameters: Record<string, Float32Array>,
) => boolean;

interface ProcessorInstance {
  process: ProcessFn;
  port: FakePort;
  gain: number;
  /** Per-sample gain applied in the last `process()` call. */
  gainCurve: Float32Array;
  /** Per-channel highpass state [x1, x2, y1, y2]. */
  filterStates: Float64Array[];
  /** Per-channel highpassed input of the last `process()` call. */
  filtered: Float32Array[];
}

/** Stand-in for the MessagePort the AudioWorkletProcessor base class provides. */
interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
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
    AudioWorkletProcessor: class {
      port: FakePort = { onmessage: null };
    },
    registerProcessor: (name: string, ctor: ProcessorCtor) => registered.set(name, ctor),
    sampleRate: SAMPLE_RATE,
  });
  const ctor = registered.get('rnnoise-processor');
  if (!ctor) throw new Error('rnnoise-processor was not registered');
  return ctor;
}

function newProcessor(): ProcessorInstance {
  return new (loadProcessor())();
}

// Values voiceIsolation.ts sets on the node (buildDenoiseGraph).
const VOICE_ISOLATION = {
  highpassHz: 100,
  highpassQ: 0.707,
  threshold: -56,
  ratio: 0.25,
  attackMs: 10,
  releaseMs: 100,
  makeupGainDb: 0,
};

/** k-rate parameter arrays with the values voiceIsolation.ts sets on the node. */
function voiceIsolationParameters(): Record<string, Float32Array> {
  return Object.fromEntries(Object.entries(VOICE_ISOLATION).map(([name, value]) => [name, Float32Array.of(value)]));
}

/** Static expander gain the worklet targets for a level `distanceDb` below the threshold. */
function expectedTargetGain(distanceDb: number): number {
  return 1 - (1 - VOICE_ISOLATION.ratio) * (Math.min(60, Math.max(0, distanceDb)) / 60);
}

/** Per-sample smoothing coefficient for a time constant in ms. */
function coefficient(ms: number): number {
  return Math.exp(-1 / (0.001 * ms * SAMPLE_RATE));
}

function energy(data: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += (data[i] ?? 0) ** 2;
  return sum;
}

function rms(data: ArrayLike<number>): number {
  return Math.sqrt(energy(data) / Math.max(1, data.length));
}

function last(values: ArrayLike<number>): number {
  return values[values.length - 1] ?? Number.NaN;
}

function lastBlock(blocks: Float32Array[]): Float32Array {
  return blocks[blocks.length - 1] ?? new Float32Array(0);
}

interface FeedOptions {
  /** Identical channels fed per quantum. */
  channels?: number;
  parameters?: Record<string, Float32Array>;
  /** Frames per render quantum; the Web Audio default is 128. */
  quantum?: number;
  frequency?: number;
  /** Applied to the input of quantum `at` (index within this call) before it is processed. */
  corrupt?: { at: number; apply: (input: Float32Array) => void };
}

interface FeedResult {
  /** Per-sample gain from `gainCurve`, concatenated over all quanta. */
  gains: number[];
  /** Channel-0 input and output of every quantum. */
  inputs: Float32Array[];
  outputs: Float32Array[];
}

/**
 * Drives one processor with a continuous sine: the sample clock carries over
 * between calls, so consecutive phases join without a phase jump.
 */
class SineDriver {
  private clock = 0;

  constructor(readonly processor: ProcessorInstance) {}

  feed(amplitude: number, quanta: number, options: FeedOptions = {}): FeedResult {
    const {
      channels = 1,
      parameters = voiceIsolationParameters(),
      quantum = QUANTUM,
      frequency = TONE_HZ,
      corrupt,
    } = options;
    const result: FeedResult = { gains: [], inputs: [], outputs: [] };
    for (let q = 0; q < quanta; q++) {
      const input = new Float32Array(quantum);
      for (let i = 0; i < quantum; i++) {
        input[i] = amplitude * Math.sin((2 * Math.PI * frequency * (this.clock + i)) / SAMPLE_RATE);
      }
      this.clock += quantum;
      if (corrupt?.at === q) corrupt.apply(input);
      const inputs = Array.from({ length: channels }, () => input.slice());
      const outputs = Array.from({ length: channels }, () => new Float32Array(quantum));
      expect(this.processor.process([inputs], [outputs], parameters)).toBe(true);
      result.gains.push(...this.processor.gainCurve);
      result.inputs.push(input);
      result.outputs.push(outputs[0] ?? new Float32Array(0));
    }
    return result;
  }
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
    const g = gains[i] ?? Number.NaN;
    if (rising ? g >= mark : g <= mark) {
      const fraction = (mark - previous) / (g - previous);
      return ((i + fraction) / SAMPLE_RATE) * 1000;
    }
    previous = g;
  }
  return Number.POSITIVE_INFINITY;
}

/** Asserts `measured` within `tolerance` (relative) of `expected`. */
function expectWithin(measured: number, expected: number, tolerance: number): void {
  expect(measured).toBeGreaterThan(expected * (1 - tolerance));
  expect(measured).toBeLessThan(expected * (1 + tolerance));
}

/** Magnitude of the worklet's highpass at `frequency`, from the Web Audio spec coefficients. */
function highpassMagnitude(frequency: number): number {
  const w0 = (2 * Math.PI * VOICE_ISOLATION.highpassHz) / SAMPLE_RATE;
  const alpha = Math.sin(w0) / (2 * 10 ** (VOICE_ISOLATION.highpassQ / 20));
  const cos = Math.cos(w0);
  const [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  const w = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const evaluate = (c0: number, c1: number, c2: number) =>
    Math.hypot(c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w), -(c1 * Math.sin(w) + c2 * Math.sin(2 * w)));
  return evaluate(b0, b1, b2) / evaluate(a0, a1, a2);
}

// Sine amplitude 0.1 is -23 dBFS RMS (far above the -56 dB threshold);
// 0.0001 is -83 dBFS RMS, 27 dB under it.
const LOUD = 0.1;
const QUIET = 0.0001;
// 1 s of audio: ten release time constants, enough to settle either way.
const SECOND_QUANTA = Math.ceil(SAMPLE_RATE / QUANTUM);

describe('rnnoise-processor worklet (noise gate)', () => {
  it('registers the processor with its k-rate parameters', () => {
    const names = loadProcessor().parameterDescriptors.map((d) => d.name);
    expect(names).toEqual(['highpassHz', 'highpassQ', 'threshold', 'ratio', 'attackMs', 'releaseMs', 'makeupGainDb']);
  });

  it('keeps the gate fully open for speech-level input', () => {
    const { gains } = new SineDriver(newProcessor()).feed(LOUD, 50);
    expect(gains.every((g) => g === 1)).toBe(true);
  });

  it('settles below the threshold on the static expander curve', () => {
    const { gains, outputs } = new SineDriver(newProcessor()).feed(QUIET, SECOND_QUANTA);
    const settled = last(gains);
    // The settled gain is constant across the last quantum, so dividing the
    // output RMS by it gives the highpassed level the gate detected.
    const levelDb = 20 * Math.log10(rms(lastBlock(outputs)) / settled);
    // After 1 s (ten release time constants) the smoother is still
    // e^-10 = 4.5e-5 of the 0.33 step away from its target: 1.5e-5.
    expect(settled).toBeCloseTo(expectedTargetGain(VOICE_ISOLATION.threshold - levelDb), 4);
    // Attenuated, but not muted.
    expect(settled).toBeGreaterThan(VOICE_ISOLATION.ratio);
    expect(settled).toBeLessThan(1);
  });

  // The smoother runs per sample against a target that is constant once the
  // detected level settled, so both time constants hold to well under 1 %.
  //
  // The release starts from a fresh processor, whose actual state is an open
  // gate (gain 1). After a loud phase the highpass rings for about 15 ms when
  // the input drops abruptly; the gate detects that ringing above the
  // threshold and starts closing later. That delay belongs to the detection
  // (it was the same with the native highpass in front of the gate), not to
  // the smoother whose time constant this measures.
  it('closes with the configured release time constant (100 ms)', () => {
    const { gains } = new SineDriver(newProcessor()).feed(QUIET, SECOND_QUANTA);
    expectWithin(measuredTimeConstantMs(gains, 1, last(gains)), VOICE_ISOLATION.releaseMs, 0.01);
  });

  it('opens with the configured attack time constant (10 ms)', () => {
    const driver = new SineDriver(newProcessor());
    // Measure from the state the closed gate actually reached, not from the
    // ideal target it approaches asymptotically.
    const closed = last(driver.feed(QUIET, SECOND_QUANTA).gains);
    const { gains } = driver.feed(LOUD, SECOND_QUANTA);
    expectWithin(measuredTimeConstantMs(gains, closed, last(gains)), VOICE_ISOLATION.attackMs, 0.01);
    expect(last(gains)).toBeCloseTo(1, 6);
  });

  it.each([64, 256, 512])('keeps both time constants at a render quantum of %i frames', (quantum) => {
    // Chromium can run a context with a non-default render quantum size; the
    // smoother must not depend on it.
    const driver = new SineDriver(newProcessor());
    const quanta = Math.ceil(SAMPLE_RATE / quantum);
    const release = driver.feed(QUIET, quanta, { quantum }).gains;
    const closed = last(release);
    const attack = driver.feed(LOUD, quanta, { quantum }).gains;
    expectWithin(measuredTimeConstantMs(release, 1, closed), VOICE_ISOLATION.releaseMs, 0.01);
    expectWithin(measuredTimeConstantMs(attack, closed, last(attack)), VOICE_ISOLATION.attackMs, 0.01);
  });

  it('ramps the gain per sample instead of stepping it at quantum boundaries', () => {
    // A gain that is only updated once per quantum jumps at every boundary
    // (zipper noise). Per-sample smoothing never moves further in one sample
    // than the first sample of the step does.
    const driver = new SineDriver(newProcessor());
    const closed = last(driver.feed(QUIET, SECOND_QUANTA).gains);
    const gains = [closed, ...driver.feed(LOUD, 20).gains];
    const firstStep = (1 - coefficient(VOICE_ISOLATION.attackMs)) * (1 - closed);
    let largest = 0;
    for (let i = 1; i < gains.length; i++) largest = Math.max(largest, (gains[i] ?? 0) - (gains[i - 1] ?? 0));
    expect(largest).toBeLessThanOrEqual(firstStep * 1.0001);
  });

  it('keeps the time constants independent of the channel count', () => {
    const mono = new SineDriver(newProcessor()).feed(QUIET, 60, { channels: 1 }).gains;
    const stereo = new SineDriver(newProcessor()).feed(QUIET, 60, { channels: 2 }).gains;
    expect(stereo).toEqual(mono);
  });

  it('applies one linked gain to every channel, driven by the loudest one', () => {
    const processor = newProcessor();
    const parameters = voiceIsolationParameters();
    const left = new Float32Array(QUANTUM);
    const right = new Float32Array(QUANTUM);
    for (let q = 0; q < SECOND_QUANTA; q++) {
      const tone = (amplitude: number) =>
        Float32Array.from(
          { length: QUANTUM },
          (_, i) => amplitude * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE),
        );
      processor.process([[tone(LOUD), tone(QUIET)]], [[left, right]], parameters);
    }
    // A loud left channel holds the gate open for the quiet right channel,
    // which on its own sits 27 dB under the threshold. Both carry the same
    // gain, so the stereo image does not shift.
    const [filteredLeft, filteredRight] = processor.filtered;
    for (let i = 0; i < QUANTUM; i++) {
      const gain = processor.gainCurve[i] ?? Number.NaN;
      expect(gain).toBeCloseTo(1, 6);
      expect(left[i]).toBe(Math.fround((filteredLeft?.[i] ?? Number.NaN) * gain));
      expect(right[i]).toBe(Math.fround((filteredRight?.[i] ?? Number.NaN) * gain));
    }
  });

  it('falls back to the descriptor defaults when parameter arrays are missing', () => {
    const Processor = loadProcessor();
    const defaults = Object.fromEntries(
      Processor.parameterDescriptors.map((d) => [d.name, Float32Array.of(d.defaultValue)]),
    );
    const explicit = new SineDriver(new Processor()).feed(QUIET, 40, { parameters: defaults }).gains;
    const missing = new SineDriver(new Processor()).feed(QUIET, 40, { parameters: {} }).gains;
    // Float32 parameter arrays round the defaults (0.707, 0.2), hence no exact match.
    const deviation = Math.max(...missing.map((g, i) => Math.abs(g - (explicit[i] ?? Number.NaN))));
    expect(deviation).toBeLessThan(1e-6);
  });

  it('removes DC with the highpass', () => {
    const processor = newProcessor();
    const parameters = voiceIsolationParameters();
    let output = new Float32Array(QUANTUM);
    for (let q = 0; q < SECOND_QUANTA; q++) {
      output = new Float32Array(QUANTUM);
      processor.process([[new Float32Array(QUANTUM).fill(LOUD)]], [[output]], parameters);
    }
    expect(output.every((y) => Math.abs(y) < 1e-3)).toBe(true);
  });

  it('passes a loud 1 kHz tone through the highpass at its spec magnitude', () => {
    const { inputs, outputs } = new SineDriver(newProcessor()).feed(LOUD, SECOND_QUANTA, { frequency: 1000 });
    // Energy over the last half second; 1 kHz does not fit a quantum in whole
    // periods, so single quanta would wobble.
    const tail = (blocks: Float32Array[]) => blocks.slice(-SECOND_QUANTA / 2).reduce((sum, b) => sum + energy(b), 0);
    const ratio = tail(outputs) / tail(inputs);
    // Q 0.707 dB is 1.085 linear, slightly above Butterworth: the response
    // peaks a little above unity before it flattens, |H(1 kHz)|^2 = 1.0115.
    // 0.02 covers that peak; a missing or misplaced filter would not.
    expect(Math.abs(ratio - 1)).toBeLessThan(0.02);
    expect(ratio).toBeCloseTo(highpassMagnitude(1000) ** 2, 3);
  });

  it.each([
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('recovers from a %s sample instead of muting for good', (_label, bad) => {
    const processor = newProcessor();
    const driver = new SineDriver(processor);
    const tailRatio = (result: FeedResult) => {
      const tailEnergy = (blocks: Float32Array[]) => blocks.slice(-10).reduce((sum, b) => sum + energy(b), 0);
      return tailEnergy(result.outputs) / tailEnergy(result.inputs);
    };
    const before = tailRatio(driver.feed(LOUD, 50));
    // The bad sample sits in the middle of a loud quantum, followed by 1 s of sine.
    const after = driver.feed(LOUD, SECOND_QUANTA, {
      corrupt: { at: 0, apply: (input) => (input[QUANTUM / 2] = bad) },
    });
    expect(after.outputs.every((block) => block.every((y) => Number.isFinite(y)))).toBe(true);
    expect(tailRatio(after)).toBeCloseTo(before, 6);
    expect(processor.filterStates.every((state) => state.every((v) => Number.isFinite(v)))).toBe(true);
    expect(Number.isFinite(processor.gain)).toBe(true);
  });

  it('resets a non-finite smoother state to an open gate', () => {
    const processor = newProcessor();
    processor.gain = Number.NaN;
    const { gains } = new SineDriver(processor).feed(LOUD, 1);
    expect(gains.every((g) => Number.isFinite(g))).toBe(true);
    expect(last(gains)).toBeCloseTo(1, 6);
  });

  it('stops processing once the graph sends the dispose message', () => {
    const processor = newProcessor();
    const parameters = voiceIsolationParameters();
    // An empty input (no channels) keeps the node alive until dispose; after
    // it, even that call returns false so the engine can drop the processor.
    const runEmpty = () => processor.process([[]], [[new Float32Array(QUANTUM)]], parameters);
    expect(runEmpty()).toBe(true);
    processor.port.onmessage?.({ data: { type: 'other' } });
    expect(runEmpty()).toBe(true);
    processor.port.onmessage?.({ data: { type: 'dispose' } });
    expect(runEmpty()).toBe(false);
    expect(processor.process([[new Float32Array(QUANTUM)]], [[new Float32Array(QUANTUM)]], parameters)).toBe(false);
  });
});
