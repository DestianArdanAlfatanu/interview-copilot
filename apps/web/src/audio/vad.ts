import type { MicVAD } from '@ricky0123/vad-web';

/**
 * AUD-04: Silero VAD on the mic stream. "start" fires on onSpeechRealStart (speech lasted
 * ≥ minSpeechMs) rather than onSpeechStart, so a cough or click doesn't close the HR turn.
 * Loaded lazily: the onnxruntime bundle is large, and a load failure must not break the page.
 */
export async function startUserVad(
  stream: MediaStream,
  onChange: (state: 'start' | 'stop') => void,
): Promise<MicVAD> {
  const { MicVAD } = await import('@ricky0123/vad-web');
  return MicVAD.new({
    model: 'v5',
    baseAssetPath: '/vad/',
    onnxWASMBasePath: '/vad/',
    getStream: async () => stream,
    // The stream is shared with the PCM pipeline: never stop its tracks from here.
    pauseStream: async () => {},
    resumeStream: async () => stream,
    startOnLoad: true,
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.4,
    minSpeechMs: 250,
    onSpeechRealStart: () => onChange('start'),
    onSpeechEnd: () => onChange('stop'),
  });
}
