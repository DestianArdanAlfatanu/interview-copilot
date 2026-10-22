/* global sampleRate, registerProcessor, AudioWorkletProcessor */
/**
 * AUD-03: mono Float32 at the context rate (usually 48 kHz) → PCM16 16 kHz, posted in 100 ms
 * chunks (1600 samples). Downsampling averages each output sample's input window (box filter),
 * which doubles as a cheap anti-alias low-pass. Also posts an RMS level for the audio meter.
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIdx = 0;
    // Running window state for the box filter.
    this.acc = 0;
    this.accN = 0;
    this.pos = 0; // input samples consumed since the current output sample started
    this.sumSq = 0;
    this.levelN = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    const channels = input.length;

    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += input[c][i];
      s /= channels;

      this.sumSq += s * s;
      this.levelN++;

      this.acc += s;
      this.accN++;
      this.pos++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = this.acc / this.accN;
        this.acc = 0;
        this.accN = 0;
        const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
        this.out[this.outIdx++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        if (this.outIdx === CHUNK_SAMPLES) {
          const level = Math.sqrt(this.sumSq / this.levelN);
          this.sumSq = 0;
          this.levelN = 0;
          const pcm = this.out;
          this.port.postMessage({ pcm: pcm.buffer, level }, [pcm.buffer]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outIdx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
