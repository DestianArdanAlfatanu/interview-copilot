import { AUDIO_CHANNEL, type AudioChannel } from '@ic/shared';

export class CaptureError extends Error {
  constructor(
    readonly code: 'unsupported_browser' | 'no_tab_audio' | 'tab_cancelled' | 'mic_denied' | 'mic_failed',
    message: string,
  ) {
    super(message);
  }
}

/** Copy from the PRD "Error dan edge case" table. */
export const CAPTURE_MESSAGES = {
  unsupported_browser: 'Capture audio tab hanya didukung Chrome dan Edge desktop.',
  no_tab_audio:
    "Audio tab tidak ikut dibagikan. Pilih tab interview lagi dan centang 'Also share tab audio'.",
  tab_cancelled: 'Berbagi tab dibatalkan.',
  mic_denied: 'Akses mikrofon ditolak. Buka ikon gembok di address bar, izinkan mikrofon, lalu coba lagi.',
  mic_failed: 'Mikrofon tidak bisa dibuka.',
} as const;

export function isSupportedBrowser() {
  const ua = navigator.userAgent;
  const chromium = /Chrome\/\d+/.test(ua) || /Edg\/\d+/.test(ua);
  const mobile = /Android|iPhone|iPad/.test(ua);
  return chromium && !mobile && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** AUD-01: tab audio. A video track is required by the API; we drop it right away. */
export async function captureTabAudio(): Promise<MediaStream> {
  if (!isSupportedBrowser()) throw new CaptureError('unsupported_browser', CAPTURE_MESSAGES.unsupported_browser);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome hints: prefer tabs, keep our own tab out of the picker.
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    } as DisplayMediaStreamOptions);
  } catch {
    throw new CaptureError('tab_cancelled', CAPTURE_MESSAGES.tab_cancelled);
  }
  const audio = stream.getAudioTracks();
  stream.getVideoTracks().forEach((t) => t.stop());
  if (audio.length === 0) throw new CaptureError('no_tab_audio', CAPTURE_MESSAGES.no_tab_audio);
  return new MediaStream(audio);
}

/** AUD-02 */
export async function captureMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new CaptureError('mic_denied', CAPTURE_MESSAGES.mic_denied);
    throw new CaptureError('mic_failed', CAPTURE_MESSAGES.mic_failed);
  }
}

type FrameSink = (frame: Uint8Array) => void;
type LevelSink = (channel: AudioChannel, level: number) => void;

/**
 * One AudioContext, one worklet node per channel. Each 100 ms PCM16 chunk is framed as
 * [channel byte][PCM16 bytes] and handed to the sink (the session WebSocket).
 */
export class AudioPipeline {
  private ctx?: AudioContext;
  private nodes = new Map<AudioChannel, { source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode }>();
  sink?: FrameSink;
  onLevel?: LevelSink;

  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('/pcm-worklet.js');
  }

  async attach(channel: AudioChannel, stream: MediaStream) {
    await this.init();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') await ctx.resume();
    this.detach(channel);
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
    worklet.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      this.onLevel?.(channel, e.data.level);
      if (!this.sink) return;
      const frame = new Uint8Array(1 + e.data.pcm.byteLength);
      frame[0] = channel;
      frame.set(new Uint8Array(e.data.pcm), 1);
      this.sink(frame);
    };
    source.connect(worklet);
    this.nodes.set(channel, { source, worklet });
  }

  detach(channel: AudioChannel) {
    const n = this.nodes.get(channel);
    if (!n) return;
    n.source.disconnect();
    n.worklet.port.onmessage = null;
    n.worklet.disconnect();
    this.nodes.delete(channel);
  }

  async close() {
    this.detach(AUDIO_CHANNEL.HR);
    this.detach(AUDIO_CHANNEL.USER);
    this.sink = undefined;
    await this.ctx?.close();
    this.ctx = undefined;
  }
}
