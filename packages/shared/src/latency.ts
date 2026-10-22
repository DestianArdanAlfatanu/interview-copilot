/** Wall-clock (epoch ms) timestamps per answer. Missing stages stay undefined. */
export interface AnswerLatency {
  /** End of the last HR word, mapped from Deepgram's audio timeline to wall clock. */
  hrSpeechEnd?: number;
  /** Turn buffer closed (speech_final / UtteranceEnd / user VAD / Space). */
  turnClosed?: number;
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
