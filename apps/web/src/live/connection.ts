import type { ClientEvent, ServerEvent } from '@ic/shared';
import { useLive } from './store';

/**
 * The single session WebSocket. Audio frames go out as binary; answer deltas coming in are
 * coalesced and applied once per animation frame (NFR: render per rAF, not per token).
 */
export class LiveConnection {
  private ws?: WebSocket;
  private pending = new Map<string, string>();
  private rafId = 0;
  private renderedAcked = new Set<string>();

  constructor(private readonly sessionId: string) {}

  connect(): Promise<void> {
    const live = useLive.getState();
    live.setConnection('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/session/${this.sessionId}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        useLive.getState().setConnection('open');
        resolve();
      };
      ws.onerror = () => {
        useLive.getState().setConnection('failed');
        reject(new Error('ws failed'));
      };
      ws.onclose = () => {
        if (this.ws === ws) useLive.getState().setConnection(useLive.getState().connection === 'open' ? 'closed' : 'failed');
      };
      ws.onmessage = (msg) => {
        if (typeof msg.data !== 'string') return;
        this.onEvent(JSON.parse(msg.data) as ServerEvent);
      };
    });
  }

  sendAudio = (frame: Uint8Array) => {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 1 << 20) this.ws.send(frame);
  };

  send(event: ClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  close() {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.rafId);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
  }

  private onEvent(e: ServerEvent) {
    if (e.type === 'answer.delta') {
      this.pending.set(e.answerId, (this.pending.get(e.answerId) ?? '') + e.text);
      // rAF doesn't fire in a hidden tab; fall back to a timer so text still accumulates.
      if (!this.rafId) this.rafId = document.hidden ? window.setTimeout(this.flush, 50) : requestAnimationFrame(this.flush);
      return;
    }
    if (e.type === 'answer.start') this.renderedAcked.delete(e.answerId);
    // Keep ordering: flush text before applying done/aborted for the same answer.
    if (this.pending.size && (e.type === 'answer.done' || e.type === 'answer.aborted')) this.flush();
    useLive.getState().apply(e);
  }

  private flush = () => {
    this.rafId = 0;
    if (this.pending.size === 0) return;
    const deltas = this.pending;
    this.pending = new Map();
    useLive.getState().appendDeltas(deltas);
    const fresh = [...deltas.keys()].filter((id) => !this.renderedAcked.has(id));
    if (fresh.length) {
      fresh.forEach((id) => this.renderedAcked.add(id));
      // Next frame callback runs after this frame has been painted.
      requestAnimationFrame(() => {
        const t = Date.now();
        for (const answerId of fresh) this.send({ type: 'answer.rendered', answerId, t });
      });
    }
  };
}
