/** Unit prices from the PRD (checked Oct 2026). USD. */
export const PRICING = {
  deepgramPerMinute: 0.0048,
  haiku: {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWrite5mPerMTok: 0.125,
  },
} as const;

export interface LlmUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export function sttCostUsd(seconds: number): number {
  return (seconds / 60) * PRICING.deepgramPerMinute;
}

export function haikuCostUsd(u: LlmUsage): number {
  const p = PRICING.haiku;
  return (
    (u.inputTokens * p.inputPerMTok +
      u.outputTokens * p.outputPerMTok +
      u.cacheReadTokens * p.cacheReadPerMTok +
      u.cacheWriteTokens * p.cacheWrite5mPerMTok) /
    1_000_000
  );
}
