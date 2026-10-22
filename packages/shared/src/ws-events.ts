import { z } from 'zod';
import { SPEAKERS } from './constants';
import type { LatencySummary, TurnCloseTrigger } from './latency';

/* ---------- client → server (JSON text frames; audio goes as binary frames) ---------- */

export const clientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('vad.user'), state: z.enum(['start', 'stop']), t: z.number() }),
  z.object({ type: z.literal('control.answer_now') }),
  z.object({ type: z.literal('control.cancel'), answerId: z.string() }),
  z.object({ type: z.literal('control.regenerate'), answerId: z.string() }),
  z.object({ type: z.literal('control.manual_question'), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('session.pause') }),
  z.object({ type: z.literal('session.resume') }),
  z.object({ type: z.literal('session.end') }),
  /** Extension to the PRD contract: first delta painted, for the "token tampil" stage. */
  z.object({ type: z.literal('answer.rendered'), answerId: z.string(), t: z.number() }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

/* ---------- server → client ---------- */

export type SttState = 'connecting' | 'live' | 'reconnecting' | 'failed';
export type SttChannelName = (typeof SPEAKERS)[number];

export interface AnswerLatencyPayload {
  /** HR end of speech → first token on screen (or server first token if not rendered yet). */
  firstWordMs?: number;
  trigger?: TurnCloseTrigger;
  stages: Record<string, number | undefined>;
}

export type ServerEvent =
  /** keyterms: what both Deepgram streams were primed with (manual first, then auto). */
  | { type: 'session.ready'; sessionId: string; mock: boolean; keyterms: string[] }
  | { type: 'transcript'; speaker: SttChannelName; text: string; isFinal: boolean; startMs: number }
  | { type: 'answer.start'; answerId: string; questionText: string; manual: boolean; mock: boolean }
  | { type: 'answer.delta'; answerId: string; text: string }
  | { type: 'answer.done'; answerId: string; outOfCv: boolean; latency: AnswerLatencyPayload }
  | { type: 'answer.skipped'; answerId: string; reason: string }
  | { type: 'answer.aborted'; answerId: string; reason: string }
  | { type: 'answer.error'; answerId: string; message: string }
  | { type: 'stt.status'; channel: SttChannelName; state: SttState }
  | {
      type: 'session.metrics';
      costUsd: number;
      latencyP50Ms?: number;
      latencyP90Ms?: number;
      questions: number;
      /** Mock-mode samples, never mixed into latencyP50Ms / latencyP90Ms. */
      mockLatency: LatencySummary;
      lastLatency?: AnswerLatencyPayload & { answerId: string; mock: boolean };
    }
  | { type: 'session.paused' }
  | { type: 'session.resumed' }
  | { type: 'session.ended' }
  | { type: 'error'; code: string; message: string };
