// Minimal pass-through AudioWorkletProcessor placeholder.
// This is the integration point for RNNoise WASM; current implementation forwards audio frames.

// Type declaration for AudioWorkletProcessor in worklet context
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: (new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor)
): void;

class RNNoiseProcessor extends AudioWorkletProcessor {
  // Simple noise gate variables (very light) to avoid total pass-through in extremely noisy input
  private readonly threshold = 0.0016; // ~-56 dBFS (etwas sensibler)
  private readonly release = 0.08; // seconds (leicht verlängert für natürliche Ausklingzeit)
  private env = 0;

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;
    const chIn = input[0];
    const chOut = output[0];
    const sr = (globalThis as any).sampleRate || 48000;
    const releaseCoeff = Math.exp(-1 / (this.release * sr));

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

registerProcessor('rnnoise-processor', RNNoiseProcessor);


