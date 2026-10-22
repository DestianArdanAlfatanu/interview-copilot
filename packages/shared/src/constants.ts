/** Byte 0 of every binary audio frame. */
export const AUDIO_CHANNEL = { HR: 0, USER: 1 } as const;
export type AudioChannel = (typeof AUDIO_CHANNEL)[keyof typeof AUDIO_CHANNEL];

export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_CHUNK_MS = 100;
export const AUDIO_CHUNK_SAMPLES = (AUDIO_SAMPLE_RATE * AUDIO_CHUNK_MS) / 1000; // 1600
export const AUDIO_CHUNK_BYTES = AUDIO_CHUNK_SAMPLES * 2; // PCM16 → 3200

export const LANGUAGES = ['id', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const ANSWER_FORMATS = ['paragraph', 'bullets'] as const;
export type AnswerFormat = (typeof ANSWER_FORMATS)[number];

export const ANSWER_LENGTHS = ['short', 'medium'] as const;
export type AnswerLength = (typeof ANSWER_LENGTHS)[number];

export const SPEAKERS = ['hr', 'user'] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const JOB_DESCRIPTION_MIN_CHARS = 200;

/** Deepgram keyterm prompting: auto-extracted from CV + job, plus manual extras from setup. */
export const MAX_AUTO_KEYTERMS = 50;
export const MAX_MANUAL_KEYTERMS = 30;
export const MAX_KEYTERM_CHARS = 40;

/** Setup field → term list: one per line or comma-separated. */
export function parseKeyterms(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[\n,;]+/)
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}
