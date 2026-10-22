/** What closed the HR turn (QD-01) or started the answer. */
export type TurnCloseTrigger =
  | 'speech_final' // Deepgram endpointing: silence ≥ DG_ENDPOINTING_MS after speech
  | 'utterance_end' // Deepgram UtteranceEnd: word-timing gap ≥ DG_UTTERANCE_END_MS
  | 'user_vad' // candidate has been speaking ≥ USER_VAD_CLOSE_MS (Silero VAD on the mic)
  | 'finalize' // we sent Deepgram a Finalize (see `finalizeBy`) and closed on its final
  | 'answer_now' // Space
  | 'manual' // typed question
  | 'regenerate'; // R / "Ulang" / Space on an already-closed turn

/** Signals that may send Deepgram a Finalize when HR's words aren't final yet. */
export type FinalizeCause = 'utterance_end' | 'answer_now' | 'user_vad';

/** The candidate must speak this long before it counts as "HR is done" (so "hmm"/"iya" doesn't). */
export const USER_VAD_CLOSE_MS = 400;

export const TRIGGER_LABEL: Record<TurnCloseTrigger, string> = {
  speech_final: 'speech_final',
  utterance_end: 'UtteranceEnd',
  user_vad: 'VAD pengguna',
  finalize: 'finalize',
  answer_now: 'Space',
  manual: 'manual',
  regenerate: 'ulang',
};

/** Wall-clock (epoch ms) timestamps per answer. Missing stages stay undefined. */
export interface AnswerLatency {
  /** End of the last HR word, mapped from Deepgram's audio timeline to wall clock. */
  hrSpeechEnd?: number;
  /** Turn buffer closed; see `trigger` for what closed it. */
  turnClosed?: number;
  trigger?: TurnCloseTrigger;
  /** When trigger = 'finalize': the signal that made us send it. */
  finalizeBy?: FinalizeCause;
  requestSent?: number;
  firstToken?: number;
  /** Client-reported: first delta painted on screen. */
  firstTokenRendered?: number;
  done?: number;
  /** Auto-detected answers only; manual/regenerated ones are excluded from p50/p90. */
  manual?: boolean;
  /** LIVE_LLM=mock — simulated answer, reported separately from real latency. */
  mock?: boolean;
}

export interface LatencySummary {
  measured: number;
  p50Ms?: number;
  p90Ms?: number;
}

export function summarize(samples: number[]): LatencySummary {
  return { measured: samples.length, p50Ms: percentile(samples, 50), p90Ms: percentile(samples, 90) };
}

/** Headline metric: HR stops speaking → first token visible (falls back to server-side stages). */
export function firstWordLatencyMs(l: AnswerLatency): number | undefined {
  const start = l.hrSpeechEnd ?? l.turnClosed;
  const end = l.firstTokenRendered ?? l.firstToken;
  if (start === undefined || end === undefined) return undefined;
  return end - start;
}

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
