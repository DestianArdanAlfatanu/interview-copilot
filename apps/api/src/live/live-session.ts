import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import WebSocket from 'ws';
import {
  AUDIO_CHANNEL,
  clientEventSchema,
  firstWordLatencyMs,
  haikuCostUsd,
  percentile,
  sttCostUsd,
  summarize,
  type AnswerLatency,
  type AnswerLatencyPayload,
  type ClientEvent,
  type LlmUsage,
  type ServerEvent,
  type Speaker,
  type TurnCloseTrigger,
  type FinalizeCause,
  USER_VAD_CLOSE_MS,
} from '@ic/shared';
import type { AppConfig } from '../config/app-config.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DeepgramStream, type SttResult } from './deepgram-stream';
import type { LlmService } from './llm.service';
import {
  OUT_OF_CV_TOKEN,
  SKIP_TOKEN,
  buildSystem,
  buildUserMessage,
  type PromptContext,
  type Turn,
} from './prompt';

interface Segment {
  utteranceId: string;
  text: string;
  endWall: number;
}

interface ActiveAnswer {
  id: string;
  question: string;
  segments: Segment[];
  /** Context snapshot (turns before this question). */
  turns: Turn[];
  /** The context turn this question was recorded as, so QD-03 can take it back. */
  turnRef?: Turn;
  manual: boolean;
  force: boolean;
  latency: AnswerLatency;
  stream?: ReturnType<LlmService['streamLive']>;
  /** Raw model text before token stripping. */
  raw: string;
  text: string;
  outOfCv: boolean;
  gateOpen: boolean;
  started: boolean;
  finished: boolean;
  latencyCounted?: boolean;
  usage?: LlmUsage;
}

const REWARM_IDLE_MS = 4.5 * 60_000; // cache TTL is 5 min
const METRICS_INTERVAL_MS = 5_000;
const INTERIM_ABORT_MIN_WORDS = 2;

/** All in-memory state for one live session / one browser WebSocket. */
export class LiveSession {
  private readonly logger: Logger;
  private readonly streams: Record<Speaker, DeepgramStream>;
  private readonly system: Anthropic.TextBlockParam[];
  private readonly maxTurns: number;
  private readonly sessionStartWall = Date.now();

  private turns: Turn[] = [];
  private hrBuffer: Segment[] = [];
  /** Latest HR interim text Deepgram hasn't finalized yet ('' = everything said is final). */
  private hrInterim = '';
  /** Set once we've sent Finalize for the current turn (max one per turn); cleared when it closes. */
  private finalizePending?: { by: FinalizeCause; force: boolean };
  /** Fires USER_VAD_CLOSE_MS after the candidate starts talking, unless they stop first. */
  private userVadTimer?: NodeJS.Timeout;
  private active?: ActiveAnswer;
  /** Most recent answer (any state) — target of Space with empty buffer / R. */
  private last?: ActiveAnswer;
  private readonly answers = new Map<string, ActiveAnswer>();
  private paused = false;
  private ended = false;
  private llmUsage: LlmUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  private firstWordSamples: number[] = [];
  /** LIVE_LLM=mock samples — reported separately, never mixed into the real p50/p90. */
  private mockSamples: number[] = [];
  private lastLlmAt = 0;
  private timers: NodeJS.Timeout[] = [];
  private persistChain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    private readonly ws: WebSocket,
    private readonly ctx: PromptContext,
    private readonly deps: { config: AppConfig; llm: LlmService; prisma: PrismaService },
    private readonly baseline: { sttSecondsHr: number; sttSecondsUser: number },
    private readonly keyterms: string[],
  ) {
    this.logger = new Logger(`Live ${sessionId.slice(0, 8)}`);
    this.system = buildSystem(ctx);
    this.maxTurns = deps.config.get('LIVE_CONTEXT_TURNS');
    const dg = (speaker: Speaker) =>
      new DeepgramStream({
        apiKey: deps.config.get('DEEPGRAM_API_KEY'),
        model: deps.config.get('DG_MODEL'),
        language: ctx.language,
        endpointingMs: deps.config.get('DG_ENDPOINTING_MS'),
        utteranceEndMs: deps.config.get('DG_UTTERANCE_END_MS'),
        keyterms,
        label: speaker,
      });
    this.streams = { hr: dg('hr'), user: dg('user') };
  }

  start() {
    for (const speaker of ['hr', 'user'] as const) {
      const s = this.streams[speaker];
      s.on('status', (state) => this.send({ type: 'stt.status', channel: speaker, state }));
      s.on('result', (r: SttResult) => this.onTranscript(speaker, r));
      if (speaker === 'hr') s.on('utteranceEnd', () => this.requestClose('utterance_end'));
      s.start();
    }

    this.ws.on('message', (data, isBinary) => {
      if (isBinary) this.onAudio(data as Buffer);
      else this.onControl(data.toString());
    });
    this.ws.on('close', () => void this.shutdown(false));

    void this.deps.llm.warmup(this.system).then((usage) => {
      if (usage) this.addUsage(usage);
      this.lastLlmAt = Date.now();
    });
    this.timers.push(
      setInterval(() => {
        if (!this.paused && Date.now() - this.lastLlmAt > REWARM_IDLE_MS) {
          this.lastLlmAt = Date.now();
          void this.deps.llm.warmup(this.system).then((u) => u && this.addUsage(u));
        }
      }, 30_000),
      setInterval(() => this.emitMetrics(), METRICS_INTERVAL_MS),
    );

    this.persist(() =>
      this.deps.prisma.session.update({
        where: { id: this.sessionId },
        data: { status: 'live', startedAt: new Date() },
      }),
    );
    this.send({ type: 'session.ready', sessionId: this.sessionId, mock: this.deps.llm.isMock, keyterms: this.keyterms });
    if (!this.deps.llm.isMock && !this.deps.llm.hasKey) this.send({ type: 'error', code: 'no_anthropic_key', message: 'ANTHROPIC_API_KEY belum diisi di .env.' });
    if (!this.deps.config.get('DEEPGRAM_API_KEY'))
      this.send({ type: 'error', code: 'no_deepgram_key', message: 'DEEPGRAM_API_KEY belum diisi di .env.' });
  }

  /** Called when a newer socket takes over this session; resolves once stats are persisted. */
  async replace() {
    this.ws.close(4000, 'replaced');
    await this.shutdown(false);
  }

  // ---------------------------------------------------------------- input

  private onAudio(frame: Buffer) {
    if (this.paused || frame.length < 3) return;
    const channel = frame[0];
    const pcm = frame.subarray(1);
    if (channel === AUDIO_CHANNEL.HR) this.streams.hr.sendAudio(pcm);
    else if (channel === AUDIO_CHANNEL.USER) this.streams.user.sendAudio(pcm);
  }

  private onControl(raw: string) {
    let event: ClientEvent;
    try {
      event = clientEventSchema.parse(JSON.parse(raw));
    } catch {
      this.send({ type: 'error', code: 'bad_event', message: 'Event tidak dikenal.' });
      return;
    }
    switch (event.type) {
      case 'vad.user':
        // QD-01: the candidate talking means HR has finished — but only once they've talked for
        // USER_VAD_CLOSE_MS, so a short "hmm"/"iya" while HR is mid-question doesn't cut it.
        clearTimeout(this.userVadTimer);
        if (event.state === 'start') {
          this.userVadTimer = setTimeout(() => this.requestClose('user_vad'), USER_VAD_CLOSE_MS);
        }
        break;
      case 'control.answer_now':
        if (this.hrBuffer.length || this.hrInterim) this.requestClose('answer_now');
        else if (this.last) this.regenerate(this.last.id, true);
        break;
      case 'control.manual_question':
        this.manualQuestion(event.text);
        break;
      case 'control.cancel':
        if (this.active?.id === event.answerId) this.abortActive('cancelled');
        break;
      case 'control.regenerate':
        this.regenerate(event.answerId, true);
        break;
      case 'answer.rendered': {
        const a = this.answers.get(event.answerId);
        if (a && a.latency.firstTokenRendered === undefined) {
          // Client clock ≈ server clock (same machine).
          a.latency.firstTokenRendered = event.t;
          if (a.finished) this.recordLatency(a);
        }
        break;
      }
      case 'session.pause':
        this.paused = true;
        this.abortActive('paused');
        this.send({ type: 'session.paused' });
        this.persist(() =>
          this.deps.prisma.session.update({ where: { id: this.sessionId }, data: { status: 'paused' } }),
        );
        break;
      case 'session.resume':
        this.paused = false;
        this.send({ type: 'session.resumed' });
        this.persist(() =>
          this.deps.prisma.session.update({ where: { id: this.sessionId }, data: { status: 'live' } }),
        );
        break;
      case 'session.end':
        void this.shutdown(true);
        break;
    }
  }

  private onTranscript(speaker: Speaker, r: SttResult) {
    if (r.text) {
      this.send({
        type: 'transcript',
        speaker,
        text: r.text,
        isFinal: r.isFinal,
        startMs: r.startWall - this.sessionStartWall,
      });
    }

    if (speaker === 'user') {
      if (r.isFinal && r.text) {
        this.pushTurn('user', r.text);
        this.saveUtterance('user', r);
      }
      return;
    }

    // QD-03: HR keeps talking while we're generating → abort, merge, wait for the full turn.
    if (r.text && this.active && !this.active.manual && !this.active.finished) {
      const words = r.text.split(/\s+/).length;
      if (r.isFinal || words >= INTERIM_ABORT_MIN_WORDS) this.takeBackActiveTurn();
    }

    if (r.isFinal) this.hrInterim = '';
    else if (r.text) this.hrInterim = r.text;

    if (r.isFinal && r.text) {
      const utteranceId = this.saveUtterance('hr', r);
      this.hrBuffer.push({ utteranceId, text: r.text, endWall: r.endWall });
    }
    if (r.fromFinalize && this.finalizePending) this.closeTurn('finalize', this.finalizePending.force);
    else if (r.speechFinal) this.closeTurn('speech_final');
  }

  // ---------------------------------------------------------------- turns

  private pushTurn(speaker: Speaker, text: string): Turn {
    const lastTurn = this.turns.at(-1);
    if (lastTurn && lastTurn.speaker === speaker && speaker === 'user') {
      lastTurn.text = `${lastTurn.text} ${text}`;
      return lastTurn;
    }
    const turn = { speaker, text };
    this.turns.push(turn);
    if (this.turns.length > this.maxTurns + 1) this.turns.splice(0, this.turns.length - (this.maxTurns + 1));
    return turn;
  }

  /**
   * A "HR is done" signal other than Deepgram's own endpointing. If HR's last words are still
   * interim, Deepgram would only finalize them seconds later on noisy call audio (the 3 s closes
   * in the WhatsApp test), so ask it to Finalize now — once per turn — and close on that final.
   */
  private requestClose(cause: FinalizeCause) {
    if (this.paused || this.ended) return;
    const force = cause === 'answer_now';
    if (!this.hrInterim) {
      this.closeTurn(cause, force);
      return;
    }
    if (this.finalizePending) {
      // Already asked for this turn; Space still upgrades the pending close to "must answer".
      this.finalizePending.force ||= force;
      return;
    }
    if (!this.streams.hr.finalize()) {
      this.closeTurn(cause, force); // STT is down: close with whatever is final
      return;
    }
    this.finalizePending = { by: cause, force };
    this.logger.log(`turn: ${cause} → Finalize (HR not final yet: "${this.hrInterim}")`);
  }

  private closeTurn(trigger: TurnCloseTrigger, force = false) {
    const finalizeBy = trigger === 'finalize' ? this.finalizePending?.by : undefined;
    // A Finalize answer settles the request even when nothing was final (the "speech" was noise),
    // so the next real turn may Finalize again.
    if (trigger === 'finalize') this.finalizePending = undefined;
    if (this.paused || this.ended || this.hrBuffer.length === 0) return;
    this.finalizePending = undefined;
    const segments = this.hrBuffer;
    this.hrBuffer = [];
    const question = segments.map((s) => s.text).join(' ');
    const turns = this.turns.slice(-this.maxTurns);
    const turnRef = this.pushTurn('hr', question); // QD-04: kept in context even if skipped
    const hrSpeechEnd = segments.at(-1)!.endWall;
    const turnClosed = Date.now();
    const via = finalizeBy ? ` (← ${finalizeBy})` : '';
    this.logger.log(`turn closed by ${trigger}${via} after ${turnClosed - hrSpeechEnd} ms: ${question}`);
    this.ask({
      question,
      segments,
      turns,
      turnRef,
      manual: false,
      force,
      latency: { hrSpeechEnd, turnClosed, trigger, finalizeBy },
    });
  }

  /** Undo the in-flight auto question: abort it and put its segments back in front of the buffer. */
  private takeBackActiveTurn() {
    const a = this.active;
    if (!a) return;
    this.abortActive('hr_continued');
    if (a.turnRef) {
      const idx = this.turns.lastIndexOf(a.turnRef);
      if (idx >= 0) this.turns.splice(idx, 1);
    }
    this.hrBuffer = [...a.segments, ...this.hrBuffer];
  }

  private manualQuestion(text: string) {
    const turns = this.turns.slice(-this.maxTurns);
    const turnRef = this.pushTurn('hr', text);
    const now = Date.now();
    this.ask({
      question: text,
      segments: [],
      turns,
      turnRef,
      manual: true,
      force: true,
      latency: { turnClosed: now, trigger: 'manual' },
    });
  }

  private regenerate(answerId: string, force: boolean) {
    const prev = this.answers.get(answerId);
    if (!prev || this.paused) return;
    if (this.active && this.active.id !== answerId) this.abortActive('superseded');
    if (this.active?.id === answerId) this.abortActive('regenerate');
    this.ask(
      {
        question: prev.question,
        segments: prev.segments,
        turns: prev.turns,
        turnRef: undefined,
        manual: true,
        force,
        latency: { turnClosed: Date.now(), trigger: 'regenerate' },
      },
      answerId,
    );
  }

  // ---------------------------------------------------------------- answers

  private ask(
    q: Pick<ActiveAnswer, 'question' | 'segments' | 'turns' | 'turnRef' | 'manual' | 'force' | 'latency'>,
    reuseId?: string,
  ) {
    if (this.active) this.abortActive('superseded');
    const answer: ActiveAnswer = {
      ...q,
      latency: { ...q.latency, manual: q.manual, mock: this.deps.llm.isMock || undefined },
      id: reuseId ?? randomUUID(),
      raw: '',
      text: '',
      outOfCv: false,
      gateOpen: false,
      started: false,
      finished: false,
    };
    this.active = answer;
    this.last = answer;
    this.answers.set(answer.id, answer);
    // Manual questions can't be skipped, so show the card immediately.
    if (answer.force) this.openCard(answer);
    void this.run(answer, 0);
  }

  private async run(a: ActiveAnswer, attempt: number): Promise<void> {
    const userText = buildUserMessage(a.turns, a.question, a.force);
    a.latency.requestSent ??= Date.now();
    this.lastLlmAt = Date.now();
    const stream = this.deps.llm.streamLive(this.system, {
      userText,
      question: a.question,
      force: a.force,
      format: this.ctx.format,
      language: this.ctx.language,
    });
    a.stream = stream;

    stream.on('text', (delta) => {
      if (this.active !== a) return;
      a.latency.firstToken ??= Date.now();
      a.raw += delta;
      this.onDelta(a);
    });

    try {
      const msg = await stream.finalMessage();
      a.usage = toUsage(msg.usage);
      this.addUsage(msg.usage);
      if (this.active !== a) return;
      this.finish(a);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || this.active !== a) return;
      const retryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError;
      if (retryable && attempt === 0 && !a.gateOpen) {
        this.logger.warn(`Claude error, retrying once: ${(err as Error).message}`);
        a.raw = '';
        return this.run(a, 1);
      }
      this.logger.error(`Claude error: ${(err as Error).message}`);
      a.finished = true;
      this.active = undefined;
      this.openCard(a);
      this.send({ type: 'answer.error', answerId: a.id, message: 'Gagal membuat jawaban.' });
      this.saveAnswer(a, 'error');
    }
  }

  /** Hold output until we know whether it starts with [SKIP] / [LUAR_CV]. */
  private onDelta(a: ActiveAnswer) {
    if (!a.gateOpen) {
      const head = a.raw.trimStart();
      if (!head) return;
      if (head.startsWith('[')) {
        // Still a possible prefix of a control token → keep holding.
        if (head.length < SKIP_TOKEN.length && SKIP_TOKEN.startsWith(head)) return;
        if (head.length < OUT_OF_CV_TOKEN.length && OUT_OF_CV_TOKEN.startsWith(head)) return;
        if (head.startsWith(SKIP_TOKEN)) {
          if (a.force) {
            a.raw = head.slice(SKIP_TOKEN.length);
          } else {
            this.skip(a);
            return;
          }
        }
      }
      a.gateOpen = true;
      this.openCard(a);
    }
    const clean = stripTokens(a.raw, a);
    if (clean.length > a.text.length) {
      this.send({ type: 'answer.delta', answerId: a.id, text: clean.slice(a.text.length) });
      a.text = clean;
    }
  }

  private openCard(a: ActiveAnswer) {
    if (a.started) return;
    a.started = true;
    this.send({
      type: 'answer.start',
      answerId: a.id,
      questionText: a.question,
      manual: a.manual,
      mock: Boolean(a.latency.mock),
    });
  }

  private skip(a: ActiveAnswer) {
    a.finished = true;
    a.stream?.abort();
    this.active = undefined;
    this.send({ type: 'answer.skipped', answerId: a.id, reason: 'not_a_question' });
    this.saveAnswer(a, 'skipped');
    this.emitMetrics();
  }

  private finish(a: ActiveAnswer) {
    a.finished = true;
    a.latency.done = Date.now();
    this.active = undefined;
    const head = a.raw.trim();
    if (!a.gateOpen && (head === '' || head.startsWith(SKIP_TOKEN)) && !a.force) {
      this.send({ type: 'answer.skipped', answerId: a.id, reason: 'not_a_question' });
      this.saveAnswer(a, 'skipped');
      this.emitMetrics();
      return;
    }
    if (!a.gateOpen) {
      // Very short output that never passed the gate (e.g. only "[LUAR_CV]").
      a.gateOpen = true;
      this.openCard(a);
      this.onDelta(a);
    }
    this.send({
      type: 'answer.done',
      answerId: a.id,
      outOfCv: a.outOfCv,
      latency: latencyPayload(a.latency),
    });
    this.recordLatency(a);
    this.saveAnswer(a, 'done');
  }

  private abortActive(reason: string) {
    const a = this.active;
    if (!a) return;
    this.active = undefined;
    a.finished = true;
    a.stream?.abort();
    if (a.started) this.send({ type: 'answer.aborted', answerId: a.id, reason });
    this.saveAnswer(a, 'aborted');
  }

  private recordLatency(a: ActiveAnswer) {
    if (a.manual || a.latencyCounted) return;
    // Wait for the client's render ack (or fall back after done).
    if (a.latency.firstTokenRendered === undefined && Date.now() - (a.latency.done ?? 0) < 1_500) {
      setTimeout(() => this.recordLatency(a), 1_500);
      return;
    }
    const ms = firstWordLatencyMs(a.latency);
    if (ms === undefined) return;
    a.latencyCounted = true;
    (a.latency.mock ? this.mockSamples : this.firstWordSamples).push(ms);
    this.logger.log(
      `${a.latency.mock ? 'MOCK ' : ''}latency ${ms} ms | trigger=${a.latency.trigger}${a.latency.finalizeBy ? `←${a.latency.finalizeBy}` : ''} ${stageLog(a.latency)} | in=${a.usage?.inputTokens} cache_read=${a.usage?.cacheReadTokens} cache_write=${a.usage?.cacheWriteTokens} out=${a.usage?.outputTokens}`,
    );
    this.emitMetrics({ ...latencyPayload(a.latency), answerId: a.id, mock: Boolean(a.latency.mock) });
  }

  // ---------------------------------------------------------------- metrics & persistence

  private addUsage(u: Anthropic.Usage) {
    const x = toUsage(u);
    this.llmUsage.inputTokens += x.inputTokens;
    this.llmUsage.cacheReadTokens += x.cacheReadTokens;
    this.llmUsage.cacheWriteTokens += x.cacheWriteTokens;
    this.llmUsage.outputTokens += x.outputTokens;
  }

  private costs() {
    const sttSeconds =
      this.baseline.sttSecondsHr + this.baseline.sttSecondsUser + this.streams.hr.billedSeconds + this.streams.user.billedSeconds;
    const stt = sttCostUsd(sttSeconds);
    const llm = haikuCostUsd(this.llmUsage);
    return { stt, llm, total: stt + llm };
  }

  private emitMetrics(lastLatency?: AnswerLatencyPayload & { answerId: string; mock: boolean }) {
    if (this.ended) return;
    this.send({
      type: 'session.metrics',
      costUsd: this.costs().total,
      latencyP50Ms: percentile(this.firstWordSamples, 50),
      latencyP90Ms: percentile(this.firstWordSamples, 90),
      questions: this.firstWordSamples.length,
      mockLatency: summarize(this.mockSamples),
      lastLatency,
    });
  }

  /** Serialized, fire-and-forget DB writes — never awaited on the audio → answer path. */
  private persist(job: () => Promise<unknown>) {
    this.persistChain = this.persistChain
      .then(() => new Promise((r) => setImmediate(r)))
      .then(job)
      .catch((err) => this.logger.error(`persist failed: ${(err as Error).message}`));
  }

  private saveUtterance(speaker: Speaker, r: SttResult): string {
    const id = randomUUID();
    this.persist(() =>
      this.deps.prisma.utterance.create({
        data: {
          id,
          sessionId: this.sessionId,
          speaker,
          text: r.text,
          startMs: Math.max(0, r.startWall - this.sessionStartWall),
          endMs: Math.max(0, r.endWall - this.sessionStartWall),
        },
      }),
    );
    return id;
  }

  private saveAnswer(a: ActiveAnswer, status: 'done' | 'skipped' | 'aborted' | 'error') {
    // Delay so a late render ack still lands in latency_json.
    const write = () =>
      this.persist(() =>
        this.deps.prisma.answer.upsert({
          where: { id: a.id },
          create: {
            id: a.id,
            sessionId: this.sessionId,
            utteranceIds: a.segments.map((s) => s.utteranceId),
            questionText: a.question,
            answerText: a.text,
            status,
            outOfCv: a.outOfCv,
            latencyJson: { ...a.latency } as object,
            inputTokens: a.usage?.inputTokens ?? 0,
            cachedTokens: a.usage?.cacheReadTokens ?? 0,
            outputTokens: a.usage?.outputTokens ?? 0,
          },
          update: {
            answerText: a.text,
            status,
            outOfCv: a.outOfCv,
            latencyJson: { ...a.latency } as object,
            inputTokens: a.usage?.inputTokens ?? 0,
            cachedTokens: a.usage?.cacheReadTokens ?? 0,
            outputTokens: a.usage?.outputTokens ?? 0,
          },
        }),
      );
    if (status === 'done') setTimeout(write, 2_000);
    else write();
  }

  private async shutdown(endSession: boolean) {
    if (this.ended) return this.persistChain;
    this.ended = true;
    this.abortActive('session_end');
    for (const t of this.timers) clearInterval(t);
    clearTimeout(this.userVadTimer);
    this.streams.hr.close();
    this.streams.user.close();
    const costs = this.costs();
    const hrSec = Math.round(this.baseline.sttSecondsHr + this.streams.hr.billedSeconds);
    const userSec = Math.round(this.baseline.sttSecondsUser + this.streams.user.billedSeconds);
    this.logger.log(
      `session ${endSession ? 'ended' : 'disconnected'}: stt ${hrSec}s+${userSec}s, cost $${costs.total.toFixed(4)}, p50 ${percentile(this.firstWordSamples, 50)} ms, mock p50 ${percentile(this.mockSamples, 50)} ms`,
    );
    this.persist(() =>
      this.deps.prisma.session.update({
        where: { id: this.sessionId },
        data: {
          status: endSession ? 'ended' : 'paused',
          endedAt: endSession ? new Date() : undefined,
          sttSecondsHr: hrSec,
          sttSecondsUser: userSec,
          sttCostUsd: sttCostUsd(hrSec + userSec),
          llmCostUsd: { increment: costs.llm },
        },
      }),
    );
    if (endSession) {
      this.send({ type: 'session.ended' });
      this.ws.close(1000, 'ended');
    }
    await this.persistChain;
  }

  private send(event: ServerEvent) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }
}

function toUsage(u: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

function stripTokens(raw: string, a: ActiveAnswer): string {
  let text = raw.trimStart();
  if (text.startsWith(OUT_OF_CV_TOKEN)) {
    a.outOfCv = true;
    text = text.slice(OUT_OF_CV_TOKEN.length).trimStart();
  }
  if (text.includes(OUT_OF_CV_TOKEN)) {
    a.outOfCv = true;
    text = text.split(OUT_OF_CV_TOKEN).join('');
  }
  return text;
}

function latencyPayload(l: AnswerLatency): AnswerLatencyPayload {
  const base = l.hrSpeechEnd ?? l.turnClosed ?? 0;
  const rel = (t?: number) => (t === undefined ? undefined : t - base);
  return {
    firstWordMs: firstWordLatencyMs(l),
    trigger: l.trigger,
    finalizeBy: l.finalizeBy,
    stages: {
      turnClosed: rel(l.turnClosed),
      requestSent: rel(l.requestSent),
      firstToken: rel(l.firstToken),
      firstTokenRendered: rel(l.firstTokenRendered),
      done: rel(l.done),
    },
  };
}

function stageLog(l: AnswerLatency) {
  const s = latencyPayload(l).stages;
  return Object.entries(s)
    .map(([k, v]) => `${k}=${v ?? '-'}`)
    .join(' ');
}
