import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { AUDIO_SAMPLE_RATE, type SttState } from '@ic/shared';

export interface DeepgramOptions {
  apiKey: string;
  model: string;
  language: string;
  endpointingMs: number;
  utteranceEndMs: number;
  /** Keyterm prompting (Nova-3): boosts recognition of these exact terms. */
  keyterms: string[];
  label: string;
}

export interface SttResult {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  /** This final was forced by our Finalize message rather than Deepgram's own endpointing. */
  fromFinalize: boolean;
  /** Wall-clock (epoch ms) of the segment's start / last word end, mapped from Deepgram's audio timeline. */
  startWall: number;
  endWall: number;
}

interface ChunkMark {
  /** Seconds of audio sent on the current connection before this chunk. */
  audioSec: number;
  /** When the chunk arrived at the server. */
  wall: number;
}

const BYTES_PER_SEC = AUDIO_SAMPLE_RATE * 2;
const KEEPALIVE_IDLE_MS = 4_000;
const MAX_BUFFER_BYTES = BYTES_PER_SEC * 10; // STT-02: ≤ 10 s buffered while reconnecting
const BACKOFF_MS = [500, 1_000, 2_000, 4_000];
const FAILED_AFTER_MS = 15_000;
const FAILED_RETRY_MS = 10_000;
const MAX_MARKS = 1_200; // ~2 min of 100 ms chunks

/**
 * One Deepgram live-transcription connection (one per speaker channel).
 * Emits: 'status' (SttState), 'result' (SttResult), 'utteranceEnd' (endWall: number).
 */
export class DeepgramStream extends EventEmitter {
  private ws?: WebSocket;
  private closedByUs = false;
  private attempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private keepAliveTimer?: NodeJS.Timeout;
  private disconnectedAt?: number;
  private lastAudioAt = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private connAudioSec = 0;
  private marks: ChunkMark[] = [];
  private state: SttState = 'connecting';
  /** Total seconds of audio delivered to Deepgram (billing). */
  billedSeconds = 0;

  constructor(private readonly opts: DeepgramOptions) {
    super();
  }

  start() {
    this.closedByUs = false;
    this.emit('status', this.state);
    this.connect();
    this.keepAliveTimer = setInterval(() => this.keepAlive(), 1_000);
  }

  sendAudio(pcm: Buffer) {
    const now = Date.now();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.write(pcm, now);
      return;
    }
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
    while (this.pendingBytes > MAX_BUFFER_BYTES && this.pending.length) {
      this.pendingBytes -= this.pending.shift()!.length;
    }
  }

  /**
   * Ask Deepgram to finalize the audio it has so far; the answer is a final result with
   * from_finalize = true. Returns false if the connection isn't open.
   */
  finalize(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'Finalize' }));
    return true;
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.keepAliveTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      setTimeout(() => ws.close(), 500);
    } else {
      ws.terminate();
    }
    this.removeAllListeners();
  }

  private connect() {
    const params = new URLSearchParams({
      model: this.opts.model,
      language: this.opts.language,
      encoding: 'linear16',
      sample_rate: String(AUDIO_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: String(this.opts.endpointingMs),
      utterance_end_ms: String(this.opts.utteranceEndMs),
      vad_events: 'true',
    });
    for (const term of this.opts.keyterms) params.append('keyterm', term);
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.opts.apiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.disconnectedAt = undefined;
      this.connAudioSec = 0;
      this.marks = [];
      this.setState('live');
      // Flush audio buffered during the outage; it's stamped "now", which slightly
      // understates latency for those words but keeps the timeline monotonic.
      const now = Date.now();
      for (const chunk of this.pending) this.write(chunk, now);
      this.pending = [];
      this.pendingBytes = 0;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      console.error(`[deepgram:${this.opts.label}] HTTP ${res.statusCode} on connect`);
    });
    ws.on('error', (err) => {
      console.error(`[deepgram:${this.opts.label}] ${err.message}`);
    });
    ws.on('close', () => {
      if (this.ws !== ws || this.closedByUs) return;
      this.ws = undefined;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    const now = Date.now();
    this.disconnectedAt ??= now;
    const down = now - this.disconnectedAt;
    this.setState(down > FAILED_AFTER_MS ? 'failed' : 'reconnecting');
    const delay =
      down > FAILED_AFTER_MS ? FAILED_RETRY_MS : BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private write(pcm: Buffer, wall: number) {
    this.marks.push({ audioSec: this.connAudioSec, wall });
    if (this.marks.length > MAX_MARKS) this.marks.splice(0, this.marks.length - MAX_MARKS);
    const sec = pcm.length / BYTES_PER_SEC;
    this.connAudioSec += sec;
    this.billedSeconds += sec;
    this.lastAudioAt = Date.now();
    this.ws!.send(pcm);
  }

  private keepAlive() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (this.disconnectedAt && this.state === 'reconnecting' && Date.now() - this.disconnectedAt > FAILED_AFTER_MS) {
        this.setState('failed');
      }
      return;
    }
    if (Date.now() - this.lastAudioAt >= KEEPALIVE_IDLE_MS) {
      this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      this.lastAudioAt = Date.now();
    }
  }

  /** Map a Deepgram timestamp (seconds on this connection's audio timeline) to wall clock. */
  private toWall(audioSec: number): number {
    const marks = this.marks;
    if (marks.length === 0) return Date.now();
    let lo = 0;
    let hi = marks.length - 1;
    if (audioSec <= marks[0].audioSec) return marks[0].wall;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].audioSec <= audioSec) lo = mid;
      else hi = mid - 1;
    }
    const m = marks[lo];
    return Math.round(m.wall + (audioSec - m.audioSec) * 1000);
  }

  private handleMessage(msg: any) {
    if (msg.type === 'Results') {
      const alt = msg.channel?.alternatives?.[0];
      const text: string = (alt?.transcript ?? '').trim();
      if (!text) {
        // Empty finals still matter: they end the utterance (speech_final), answer a Finalize,
        // and tell the session there is no pending interim text any more.
        if (msg.is_final || msg.speech_final) this.emit('result', this.result('', msg, alt));
        return;
      }
      this.emit('result', this.result(text, msg, alt));
    } else if (msg.type === 'UtteranceEnd') {
      this.emit('utteranceEnd', this.toWall(msg.last_word_end ?? 0));
    }
  }

  private result(text: string, msg: any, alt: any): SttResult {
    const words: Array<{ start: number; end: number }> = alt?.words ?? [];
    const start = words[0]?.start ?? msg.start ?? 0;
    const end = words.at(-1)?.end ?? (msg.start ?? 0) + (msg.duration ?? 0);
    return {
      text,
      isFinal: Boolean(msg.is_final),
      speechFinal: Boolean(msg.speech_final),
      fromFinalize: Boolean(msg.from_finalize),
      startWall: this.toWall(start),
      endWall: this.toWall(end),
    };
  }

  private setState(state: SttState) {
    if (state === this.state) return;
    this.state = state;
    this.emit('status', state);
  }
}
