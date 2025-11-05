// Minimal pass-through AudioWorkletProcessor placeholder.
// This is the integration point for RNNoise WASM; current implementation forwards audio frames.

class RNNoiseProcessor extends AudioWorkletProcessor {
  // Simple noise gate variables (very light) to avoid total pass-through in extremely noisy input
  private readonly threshold = 0.0025; // ~-52 dBFS
  private readonly release = 0.05; // seconds
  private env = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const chIn = input[0];
    const chOut = output[0];
    const sampleRate = sampleRate || 48000;
    const releaseCoeff = Math.exp(-1 / (this.release * sampleRate));

    for (let i = 0; i < chIn.length; i++) {
      const s = chIn[i];
      const abs = Math.abs(s);
      this.env = Math.max(abs, this.env * releaseCoeff);
      const gate = this.env > this.threshold ? 1 : 0;
      chOut[i] = s * gate;
    }
    return true;
  }
}

// @ts-ignore
registerProcessor('rnnoise-processor', RNNoiseProcessor);


