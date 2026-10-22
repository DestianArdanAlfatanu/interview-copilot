import type { MicVAD } from '@ricky0123/vad-web';

/**
 * AUD-04: Silero VAD on the mic stream. "start" fires as soon as speech is detected and "stop"
 * when it ends or turns out to be a misfire; the server only treats it as "HR is done" once the
 * candidate has kept talking for USER_VAD_CLOSE_MS, so "hmm"/"iya" doesn't cut HR off.
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
    onSpeechStart: () => onChange('start'),
    onSpeechEnd: () => onChange('stop'),
    onVADMisfire: () => onChange('stop'),
  });
}
