/*
  Minimal noise-gate / downward expander as an AudioWorkletProcessor, with the
  rumble highpass in front of it.
  Goal: attenuate quiet, stationary noise (typing / drilling are only marginally improved).

  Parameters (defaults live in PARAMETER_DESCRIPTORS, the single source of truth):
  - highpassHz: cutoff of the second-order highpass in front of the gate.
  - highpassQ: its Q, in dB like BiquadFilterNode.Q for type 'highpass'.
  - threshold (dBFS): level below which the signal is attenuated.
  - ratio: gain reached 60 dB or more below the threshold; between threshold
    and that floor the gain falls linearly with the distance in dB.
  - attackMs: time constant (63 %) for the gain rising towards an open gate.
  - releaseMs: time constant (63 %) for the gain falling towards a closed gate.
  - makeupGainDb: optional make-up gain in dB.

  Signal flow per channel: non-finite samples become 0, then the highpass,
  then the gain. Sanitizing has to happen before the first recursive filter:
  one NaN in an IIR state keeps that filter at NaN for good. The highpass
  therefore lives here instead of in a BiquadFilterNode in front of the
  worklet, and uses the coefficients the Web Audio spec defines for that node.

  The level is detected once per render quantum (RMS of the loudest filtered
  channel); the gain follows its target with a one-pole smoother advanced once
  per sample, so time constants hold at any quantum size and the gain ramps
  instead of stepping at quantum boundaries. All channels share that gain
  (stereo link), so a multi-channel input keeps its image.

  Note: this is NOT RNNoise (ML). The file name matches the previous reference
  so that the existing load path stays unchanged.
*/

const PARAMETER_DESCRIPTORS = [
  { name: 'highpassHz', defaultValue: 100, minValue: 10, maxValue: 1000, automationRate: 'k-rate' },
  { name: 'highpassQ', defaultValue: 0.707, minValue: -20, maxValue: 20, automationRate: 'k-rate' },
  { name: 'threshold', defaultValue: -56, minValue: -100, maxValue: -10, automationRate: 'k-rate' },
  { name: 'ratio', defaultValue: 0.2, minValue: 0.05, maxValue: 1.0, automationRate: 'k-rate' },
  { name: 'attackMs', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
  { name: 'releaseMs', defaultValue: 100, minValue: 5, maxValue: 1000, automationRate: 'k-rate' },
  { name: 'makeupGainDb', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
];

const PARAMETER_DEFAULTS = Object.fromEntries(PARAMETER_DESCRIPTORS.map((d) => [d.name, d.defaultValue]));

// Distance below the threshold at which the gain reaches `ratio`.
const EXPANDER_RANGE_DB = 60;

function readParameter(parameters, name) {
  const values = parameters[name];
  return values && values.length > 0 ? values[0] : PARAMETER_DEFAULTS[name];
}

function dbToLin(db) {
  return Math.pow(10, db / 20);
}

// Normalized highpass coefficients as the Web Audio spec defines them for
// BiquadFilterNode type 'highpass' (Q in dB), so the response matches the
// native node this replaces.
function highpassCoefficients(frequency, qDb) {
  const w0 = (2 * Math.PI * frequency) / sampleRate; // `sampleRate` is a worklet-scope global
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW0) / 2 / a0,
    b1: -(1 + cosW0) / a0,
    b2: (1 + cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

// Short-term RMS level of one channel over a render quantum, in dBFS.
function rmsDb(channelData, n) {
  let sum = 0.0;
  for (let i = 0; i < n; i++) {
    const s = channelData[i];
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return 20 * Math.log10(Math.max(rms, 1e-8));
}

// Static expander curve: 1 at or above the threshold, falling linearly with
// the distance in dB down to `ratio` at EXPANDER_RANGE_DB below it.
function expanderGain(levelDb, thresholdDb, ratio) {
  const below = thresholdDb - levelDb;
  if (below <= 0) return 1.0;
  const distance = Math.min(EXPANDER_RANGE_DB, below);
  return Math.max(0, 1 - (1 - ratio) * (distance / EXPANDER_RANGE_DB));
}

// One-pole coefficient for a time constant in ms, applied once per sample.
function smoothingCoefficient(ms) {
  return Math.exp(-1.0 / (0.001 * ms * sampleRate));
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMETER_DESCRIPTORS;
  }

  constructor() {
    super();
    this.gain = 1.0;
    this.gainCurve = new Float32Array(0);
    // Per channel: highpass state [x1, x2, y1, y2] and the filtered quantum.
    this.filterStates = [];
    this.filtered = [];
    this.coefficients = null;
    this.coefficientKey = '';
    // Set by the owning graph on teardown; process() then returns false so
    // the engine can drop the processor instead of running it until the
    // AudioContext closes.
    this.disposed = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'dispose') this.disposed = true;
    };
  }

  updateCoefficients(parameters) {
    const frequency = readParameter(parameters, 'highpassHz');
    const qDb = readParameter(parameters, 'highpassQ');
    const key = `${frequency}/${qDb}`;
    if (key !== this.coefficientKey) {
      this.coefficients = highpassCoefficients(frequency, qDb);
      this.coefficientKey = key;
    }
    return this.coefficients;
  }

  // Sanitizes and highpass-filters one channel into its scratch buffer.
  filterChannel(ch, inCh, c) {
    const n = inCh.length;
    if (!this.filterStates[ch]) this.filterStates[ch] = new Float64Array(4);
    if (!this.filtered[ch] || this.filtered[ch].length !== n) this.filtered[ch] = new Float32Array(n);
    const state = this.filterStates[ch];
    const out = this.filtered[ch];
    let [x1, x2, y1, y2] = state;
    for (let i = 0; i < n; i++) {
      const raw = inCh[i];
      const x = Number.isFinite(raw) ? raw : 0;
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    state[0] = x1;
    state[1] = x2;
    state[2] = y1;
    state[3] = y2;
    return out;
  }

  // Advances the smoothed gain once per sample and returns the per-sample
  // curve (make-up gain included) for this quantum.
  computeGainCurve(frames, targetGain, coefficient, makeup) {
    if (this.gainCurve.length !== frames) this.gainCurve = new Float32Array(frames);
    const curve = this.gainCurve;
    let gain = this.gain;
    for (let i = 0; i < frames; i++) {
      gain = targetGain + coefficient * (gain - targetGain);
      curve[i] = gain * makeup;
    }
    this.gain = gain;
    return curve;
  }

  process(inputs, outputs, parameters) {
    if (this.disposed) {
      return false;
    }
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) {
      return true;
    }

    // Filter every channel, then detect linked: the loudest one decides.
    const c = this.updateCoefficients(parameters);
    let levelDb = Number.NEGATIVE_INFINITY;
    let frames = 0;
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      if (!inCh || inCh.length === 0) continue;
      const filtered = this.filterChannel(ch, inCh, c);
      levelDb = Math.max(levelDb, rmsDb(filtered, inCh.length));
      frames = Math.max(frames, inCh.length);
    }
    if (frames === 0) {
      return true;
    }

    const targetGain = expanderGain(
      levelDb,
      readParameter(parameters, 'threshold'),
      readParameter(parameters, 'ratio'),
    );
    // Defensive: a non-finite smoother state would never recover on its own.
    if (!Number.isFinite(this.gain)) this.gain = 1.0;
    // The target is constant across the quantum, so the gain moves
    // monotonically towards it and one coefficient covers every sample.
    const timeConstantMs =
      targetGain > this.gain ? readParameter(parameters, 'attackMs') : readParameter(parameters, 'releaseMs');
    const makeup = dbToLin(readParameter(parameters, 'makeupGainDb'));
    const curve = this.computeGainCurve(frames, targetGain, smoothingCoefficient(timeConstantMs), makeup);

    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || inCh.length === 0 || !outCh) continue;
      const filtered = this.filtered[ch];
      const n = Math.min(inCh.length, outCh.length);
      for (let i = 0; i < n; i++) {
        outCh[i] = filtered[i] * curve[i];
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', NoiseGateProcessor);
