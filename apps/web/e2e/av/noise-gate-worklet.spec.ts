import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Runs the shipped noise gate worklet in the real audio engine of every
 * browser project, without an app server: the page is an empty document
 * served by page.route, the worklet source is read from disk and loaded via
 * a Blob URL. Every case renders a mono OfflineAudioContext at 48 kHz.
 *
 * The unit tests (rnnoise-processor.test.ts) run the same file in a Node vm;
 * these cases check what only an engine can show: that the worklet's
 * highpass matches the native BiquadFilterNode, that a non-finite source
 * sample does not mute the production chain, and that the time constants
 * hold with the engine's render quantum.
 */

const PAGE_URL = 'https://noise-gate.test/';
const SAMPLE_RATE = 48_000;
const QUANTUM = 128;
const QUANTA_PER_SECOND = SAMPLE_RATE / QUANTUM;
const WORKLET_SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/av/audio/worklets/rnnoise-processor.js', import.meta.url)),
  'utf8',
);

// Values voiceIsolation.ts sets on the node (buildDenoiseGraph).
const GATE_PARAMETERS = {
  highpassHz: 100,
  highpassQ: 0.707,
  threshold: -56,
  ratio: 0.25,
  attackMs: 10,
  releaseMs: 100,
  makeupGainDb: 0,
};

// The soft limiter voiceIsolation.ts puts behind the gate.
const LIMITER = { threshold: -3, knee: 12, ratio: 6, attack: 0.005, release: 0.05 };

type Chain = 'equivalence' | 'production' | 'nativeHighpassInFront' | 'gateOnly';

interface SignalSpec {
  kind: 'noise' | 'sine';
  /** Noise: amplitude of a uniform distribution; sine: per segment. */
  segments: { amplitude: number; seconds: number }[];
  frequency?: number;
  seed?: number;
  /** One sample replaced before rendering; the value travels as a string so NaN and Infinity survive. */
  bad?: { index: number; value: 'NaN' | 'Infinity' | '-Infinity' };
}

interface RenderRequest {
  source: string;
  signal: SignalSpec;
  chain: Chain;
  gate: Record<string, number>;
  limiter: Record<string, number>;
  sampleRate: number;
}

interface Rendered {
  input: number[];
  /** One array per destination channel. */
  channels: number[][];
}

/**
 * Executed in the page. Builds the signal, renders it through the requested
 * chain and returns the input and every output channel.
 */
async function renderInPage(request: RenderRequest): Promise<Rendered> {
  const { signal, sampleRate } = request;
  const length = Math.round(signal.segments.reduce((sum, s) => sum + s.seconds, 0) * sampleRate);
  const data = new Float32Array(length);
  // mulberry32: deterministic, so every engine renders the same noise.
  let seed = signal.seed ?? 1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let offset = 0;
  for (const segment of signal.segments) {
    const end = Math.min(length, offset + Math.round(segment.seconds * sampleRate));
    for (let i = offset; i < end; i++) {
      data[i] =
        signal.kind === 'noise'
          ? segment.amplitude * (2 * random() - 1)
          : segment.amplitude * Math.sin((2 * Math.PI * (signal.frequency ?? 0) * i) / sampleRate);
    }
    offset = end;
  }
  if (signal.bad) data[signal.bad.index] = Number(signal.bad.value);

  const channelCount = request.chain === 'equivalence' ? 2 : 1;
  const context = new OfflineAudioContext(channelCount, length, sampleRate);
  const moduleUrl = URL.createObjectURL(new Blob([request.source], { type: 'text/javascript' }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const buffer = context.createBuffer(1, length, sampleRate);
  buffer.copyToChannel(data, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;

  const gate = new AudioWorkletNode(context, 'rnnoise-processor');
  for (const [name, value] of Object.entries(request.gate)) {
    gate.parameters.get(name)?.setValueAtTime(value, 0);
  }
  const nativeHighpass = () => {
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = request.gate.highpassHz ?? 0;
    filter.Q.value = request.gate.highpassQ ?? 0;
    return filter;
  };
  const limiter = () => {
    const node = context.createDynamicsCompressor();
    node.threshold.value = request.limiter.threshold ?? 0;
    node.knee.value = request.limiter.knee ?? 0;
    node.ratio.value = request.limiter.ratio ?? 1;
    node.attack.value = request.limiter.attack ?? 0;
    node.release.value = request.limiter.release ?? 0;
    return node;
  };

  if (request.chain === 'equivalence') {
    const merger = context.createChannelMerger(2);
    const reference = nativeHighpass();
    source.connect(gate).connect(merger, 0, 0);
    source.connect(reference).connect(merger, 0, 1);
    merger.connect(context.destination);
  } else if (request.chain === 'production') {
    source.connect(gate).connect(limiter()).connect(context.destination);
  } else if (request.chain === 'nativeHighpassInFront') {
    // The chain before this change, kept as the counter-check.
    source.connect(nativeHighpass()).connect(gate).connect(limiter()).connect(context.destination);
  } else {
    source.connect(gate).connect(context.destination);
  }
  source.start(0);
  const rendered = await context.startRendering();
  const channels: number[][] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) channels.push(Array.from(rendered.getChannelData(c)));
  return { input: Array.from(data), channels };
}

async function render(page: Page, signal: SignalSpec, chain: Chain): Promise<Rendered> {
  return page.evaluate(renderInPage, {
    source: WORKLET_SOURCE,
    signal,
    chain,
    gate: GATE_PARAMETERS,
    limiter: LIMITER,
    sampleRate: SAMPLE_RATE,
  });
}

function rms(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / Math.max(1, values.length));
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
}

function seconds(s: number): number {
  return Math.round(s * SAMPLE_RATE);
}

/** Per-quantum gain: output RMS over input RMS of every render quantum. */
function quantumGains(input: number[], output: number[]): number[] {
  const gains: number[] = [];
  for (let start = 0; start + QUANTUM <= input.length; start += QUANTUM) {
    gains.push(rms(output.slice(start, start + QUANTUM)) / rms(input.slice(start, start + QUANTUM)));
  }
  return gains;
}

/**
 * Time constant in ms: time until the per-quantum gain covered 1 - 1/e
 * (63.2 %) of the step from `start` (at the phase start) to `target`,
 * linearly interpolated over the quantum centres.
 */
function timeConstantMs(gains: number[], start: number, target: number): number {
  const mark = target + (start - target) / Math.E;
  const rising = target > start;
  let previousTime = 0;
  let previous = start;
  for (let q = 0; q < gains.length; q++) {
    const time = ((q + 0.5) * QUANTUM * 1000) / SAMPLE_RATE;
    const g = gains[q] ?? Number.NaN;
    if (rising ? g >= mark : g <= mark) {
      return previousTime + ((mark - previous) / (g - previous)) * (time - previousTime);
    }
    previousTime = time;
    previous = g;
  }
  return Number.POSITIVE_INFINITY;
}

function note(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: 'measurement', description: `${testInfo.project.name}: ${description}` });
}

test.describe('noise gate worklet in the browser audio engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(PAGE_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>noise gate</title>' }),
    );
    await page.goto(PAGE_URL);
    // AudioWorklet only exists in a secure context.
    expect(await page.evaluate(() => window.isSecureContext && 'audioWorklet' in BaseAudioContext.prototype)).toBe(
      true,
    );
  });

  test('matches the native BiquadFilterNode highpass', async ({ page }, testInfo) => {
    // Uniform noise at 0.1 is about -25 dBFS RMS, far above the -56 dB
    // threshold: the gate keeps its gain at exactly 1 and only the highpass
    // shapes the output.
    const { channels } = await render(
      page,
      { kind: 'noise', seed: 4711, segments: [{ amplitude: 0.1, seconds: 1 }] },
      'equivalence',
    );
    const [worklet = [], native = []] = channels;
    let maxDeviation = 0;
    for (let i = 0; i < worklet.length; i++) {
      maxDeviation = Math.max(maxDeviation, Math.abs((worklet[i] ?? 0) - (native[i] ?? 0)));
    }
    note(testInfo, `max deviation worklet vs native highpass ${maxDeviation.toExponential(2)}`);
    // Both filters run the same spec coefficients (Q in dB); what remains is
    // float rounding of coefficients, state and the Float32 output. Measured
    // with Playwright 1.65.1: Chromium 2.21e-6, Firefox 2.84e-14, WebKit
    // 2.56e-6. The same input computed in Node with Q read as linear deviates
    // by 8.7e-3, with a 110 Hz cutoff by 3.2e-3, so the 1e-4 bound separates
    // the spec filter from both mistakes by more than an order of magnitude.
    expect(maxDeviation).toBeLessThan(1e-4);
    expect(rms(worklet)).toBeGreaterThan(0.05);
  });

  for (const bad of ['NaN', 'Infinity', '-Infinity'] as const) {
    test(`keeps the production chain audible after a ${bad} sample`, async ({ page }, testInfo) => {
      const signal: SignalSpec = {
        kind: 'sine',
        frequency: 440,
        segments: [{ amplitude: 0.1, seconds: 2 }],
        bad: { index: seconds(0.5), value: bad },
      };
      const [output = []] = (await render(page, signal, 'production')).channels;
      const before = rms(output.slice(seconds(0.25), seconds(0.5)));
      const after = rms(output.slice(seconds(1.5)));
      // Counter-check: the chain before this change, with the native highpass
      // in front of the gate. Recorded, not asserted: whether a non-finite
      // sample reaches the graph unchanged is up to the engine.
      const [control = []] = (await render(page, signal, 'nativeHighpassInFront')).channels;
      const controlFinite = control.every((y) => Number.isFinite(y));
      note(
        testInfo,
        `${bad}: rms before ${before.toFixed(5)}, last 500 ms ${after.toFixed(5)}; ` +
          `native highpass in front: rms last 500 ms ${controlFinite ? rms(control.slice(seconds(1.5))).toFixed(5) : 'non-finite output'}`,
      );
      expect(output.every((y) => Number.isFinite(y))).toBe(true);
      expect(before).toBeGreaterThan(0.05);
      expect(after).toBeGreaterThan(before * 0.8);
    });
  }

  test('holds the attack and release time constants in the engine', async ({ page }, testInfo) => {
    // 375 Hz is one period per 128-frame quantum, so the RMS per quantum is
    // constant. Phases: quiet 1 s (the fresh, open gate closes), loud 1 s
    // (it opens), quiet 1 s (it closes after a loud phase).
    const { input, channels } = await render(
      page,
      {
        kind: 'sine',
        frequency: 375,
        segments: [
          { amplitude: 0.0001, seconds: 1 },
          { amplitude: 0.1, seconds: 1 },
          { amplitude: 0.0001, seconds: 1 },
        ],
      },
      'gateOnly',
    );
    const gains = quantumGains(input, channels[0] ?? []);
    // Normalize on the settled loud phase: that removes the highpass gain at
    // 375 Hz (about 1.04) and leaves the gate's gain.
    const loud = mean(gains.slice(2 * QUANTA_PER_SECOND - QUANTA_PER_SECOND / 4, 2 * QUANTA_PER_SECOND));
    const normalized = gains.map((g) => g / loud);
    const phase = (index: number) => normalized.slice(index * QUANTA_PER_SECOND, (index + 1) * QUANTA_PER_SECOND);
    const settledEnd = (values: number[]) => mean(values.slice(-QUANTA_PER_SECOND / 10));

    // Release from the fresh processor, whose state is an open gate (gain 1).
    const release = timeConstantMs(phase(0), 1, settledEnd(phase(0)));
    // Attack from the state the closed gate actually reached.
    const attack = timeConstantMs(phase(1), normalized[QUANTA_PER_SECOND - 1] ?? Number.NaN, 1);
    // After a loud phase the highpass rings for about 15 ms when the input
    // drops abruptly, and the gate detects that ringing above the threshold:
    // it starts closing later. Recorded, not asserted; it is a property of
    // the detection, not of the smoother time constant measured above.
    const releaseAfterLoud = timeConstantMs(phase(2), 1, settledEnd(phase(2)));
    note(
      testInfo,
      `release ${release.toFixed(2)} ms, attack ${attack.toFixed(2)} ms, release after loud phase ${releaseAfterLoud.toFixed(2)} ms`,
    );
    // The gain moves within every quantum while one value per quantum is
    // measured. Over a 2.7 ms quantum that is small against 100 ms (5 %), but
    // not against 10 ms: averaging the steep start of the attack inside each
    // quantum shifts the measured point by several percent (15 %).
    expect(release).toBeGreaterThan(100 * 0.95);
    expect(release).toBeLessThan(100 * 1.05);
    expect(attack).toBeGreaterThan(10 * 0.85);
    expect(attack).toBeLessThan(10 * 1.15);
  });
});
