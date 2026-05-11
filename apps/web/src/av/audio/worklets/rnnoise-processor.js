/*
  Minimal noise-gate / expander implementation as an AudioWorkletProcessor.
  Goal: attenuate quiet, stationary noise (typing / drilling are only marginally improved).

  Parameters:
  - threshold (dBFS): level below which the signal is attenuated. Default: -50 dB
  - ratio: expansion ratio (< 1.0 means stronger attenuation). Default: 0.2
  - attackMs: time constant for gain rise. Default: 10 ms
  - releaseMs: time constant for gain fall. Default: 120 ms
  - makeupGainDb: optional make-up gain in dB (Default: 0)

  Note: this is NOT RNNoise (ML). The file name matches the previous reference
  so that the existing load path stays unchanged.
*/

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -56, minValue: -100, maxValue: -10, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 0.2, minValue: 0.05, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'attackMs', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      { name: 'releaseMs', defaultValue: 100, minValue: 5, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'makeupGainDb', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.envelope = 0.0;
    this.lastGain = 1.0;
  }

  dbToLin(db) {
    return Math.pow(10, db / 20);
  }

  // Short-term RMS estimate over a render quantum
  computeRmsDb(channelData) {
    let sum = 0.0;
    const N = channelData.length;
    for (let i = 0; i < N; i++) {
      const s = channelData[i];
      sum += s * s;
    }
    const rms = Math.sqrt(sum / Math.max(1, N));
    const db = 20 * Math.log10(Math.max(rms, 1e-8));
    return db;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const attackMs = parameters.attackMs?.length ? parameters.attackMs[0] : 10;
    const releaseMs = parameters.releaseMs?.length ? parameters.releaseMs[0] : 120;
    const threshDb = parameters.threshold?.length ? parameters.threshold[0] : -50;
    const ratio = parameters.ratio?.length ? parameters.ratio[0] : 0.2;
    const makeupDb = parameters.makeupGainDb?.length ? parameters.makeupGainDb[0] : 0;

    const sampleRate = sampleRate; // global in worklet scope
    const attackCoeff = Math.exp(-1.0 / (0.001 * attackMs * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (0.001 * releaseMs * sampleRate));

    // Handle mono and multi-channel input identically
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;

      // Short-term level estimate per quantum
      const levelDb = this.computeRmsDb(inCh);
      const above = levelDb - threshDb;

      // Expander: below threshold the gain drops below 1, above it stays near 1
      let targetGain;
      if (above < 0) {
        // the further below the threshold, the stronger the attenuation
        const distance = Math.min(60, -above); // cap at 60 dB
        const lin = Math.max(0, 1 - (1 - ratio) * (distance / 60));
        targetGain = lin;
      } else {
        targetGain = 1.0;
      }

      // Smoothing (attack / release)
      const coeff = targetGain > this.lastGain ? attackCoeff : releaseCoeff;
      const newGain = targetGain + coeff * (this.lastGain - targetGain);
      this.lastGain = newGain;

      // Make-up gain
      const makeup = this.dbToLin(makeupDb);
      const g = newGain * makeup;

      for (let i = 0; i < inCh.length; i++) {
        outCh[i] = inCh[i] * g;
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', NoiseGateProcessor);
