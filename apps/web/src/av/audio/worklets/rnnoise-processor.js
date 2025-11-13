/*
  Minimalistische Noise-Gate/Expander-Implementierung als AudioWorkletProcessor.
  Ziel: Leises, stationäres Rauschen dämpfen (Tastatur/Bohrgeräusche werden nur begrenzt verbessert).

  Parameter:
  - threshold (dBFS): Pegel unterhalb dessen das Signal abgesenkt wird. Default: -50 dB
  - ratio: Expansions-Verhältnis (< 1.0 → stärkere Absenkung). Default: 0.2
  - attackMs: Zeitkonstante für Anstieg des Gains. Default: 10 ms
  - releaseMs: Zeitkonstante für Abfall des Gains. Default: 120 ms
  - makeupGainDb: Optionaler Make-Up-Gain in dB (Default: 0)

  Hinweis: Dies ist KEIN RNNoise (ML). Der Dateiname entspricht der bisherigen Referenz,
  um den bestehenden Ladepfad nicht zu ändern.
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

  // Schätzung des Kurzzeit-RMS über einen Render-Quantum
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

    const sampleRate = sampleRate; // global in Worklet-Scope
    const attackCoeff = Math.exp(-1.0 / (0.001 * attackMs * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (0.001 * releaseMs * sampleRate));

    // Mono/Mehrkanal identisch behandeln
    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;

      // Kurzzeit-Pegelschätzung pro Quantum
      const levelDb = this.computeRmsDb(inCh);
      const above = levelDb - threshDb;

      // Expander: unterhalb der Schwelle → Gain < 1, oberhalb → nahe 1
      let targetGain;
      if (above < 0) {
        // je weiter unterhalb, desto stärker absenken
        const distance = Math.min(60, -above); // Kappe bei 60 dB
        const lin = Math.max(0, 1 - (1 - ratio) * (distance / 60));
        targetGain = lin;
      } else {
        targetGain = 1.0;
      }

      // Glättung (Attack/Release)
      const coeff = targetGain > this.lastGain ? attackCoeff : releaseCoeff;
      const newGain = targetGain + coeff * (this.lastGain - targetGain);
      this.lastGain = newGain;

      // Make-Up-Gain
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


