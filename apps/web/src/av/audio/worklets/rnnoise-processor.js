/*
  Minimal noise-gate / downward expander as an AudioWorkletProcessor.
  Goal: attenuate quiet, stationary noise (typing / drilling are only marginally improved).

  Parameters (defaults live in PARAMETER_DESCRIPTORS, the single source of truth):
  - threshold (dBFS): level below which the signal is attenuated.
  - ratio: gain reached 60 dB or more below the threshold; between threshold
    and that floor the gain falls linearly with the distance in dB.
  - attackMs: time constant (63 %) for the gain rising towards an open gate.
  - releaseMs: time constant (63 %) for the gain falling towards a closed gate.
  - makeupGainDb: optional make-up gain in dB.

  The level is detected once per render quantum (RMS of the loudest channel);
  the gain follows its target with a one-pole smoother advanced once per
  sample, so time constants hold at any quantum size and the gain ramps
  instead of stepping at quantum boundaries. All channels share that gain
  (stereo link), so a multi-channel input keeps its image.

  Note: this is NOT RNNoise (ML). The file name matches the previous reference
  so that the existing load path stays unchanged.
*/

const PARAMETER_DESCRIPTORS = [
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

// Short-term RMS level of one channel over a render quantum, in dBFS.
// Non-finite samples are skipped: a single NaN would otherwise turn the level,
// the target gain and the smoother state into NaN for good.
function rmsDb(channelData) {
  let sum = 0.0;
  let count = 0;
  const n = channelData.length;
  for (let i = 0; i < n; i++) {
    const s = channelData[i];
    if (!Number.isFinite(s)) continue;
    sum += s * s;
    count++;
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
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
  return Math.exp(-1.0 / (0.001 * ms * sampleRate)); // `sampleRate` is a worklet-scope global
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMETER_DESCRIPTORS;
  }

  constructor() {
    super();
    this.gain = 1.0;
    this.gainCurve = new Float32Array(0);
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
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output) {
      return true;
    }

    // Linked detection: the loudest channel decides for all of them.
    let levelDb = Number.NEGATIVE_INFINITY;
    let frames = 0;
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      if (!inCh || inCh.length === 0) continue;
      levelDb = Math.max(levelDb, rmsDb(inCh));
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
      if (!inCh || !outCh) continue;
      const n = Math.min(inCh.length, outCh.length);
      for (let i = 0; i < n; i++) {
        const s = inCh[i];
        // Keep non-finite samples away from the limiter's internal state.
        outCh[i] = Number.isFinite(s) ? s * curve[i] : 0;
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', NoiseGateProcessor);
