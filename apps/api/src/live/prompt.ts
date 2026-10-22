import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerFormat, AnswerLength, Language, Speaker } from '@ic/shared';

export interface PromptContext {
  language: Language;
  format: AnswerFormat;
  length: AnswerLength;
  cvText: string;
  job: { company: string; position: string; description: string; notes: string | null };
  /** Prep analysis + answer bank (M1). Empty in M0. */
  analysis: string;
}

export interface Turn {
  speaker: Speaker;
  text: string;
}

const LANGUAGE_LABEL: Record<Language, string> = { id: 'Bahasa Indonesia', en: 'English' };

/** PRD "Format dan panjang jawaban" table. */
const SHAPE: Record<AnswerFormat, Record<AnswerLength, string>> = {
  paragraph: { short: 'paragraf, maksimal 50 kata', medium: 'paragraf, maksimal 90 kata' },
  bullets: {
    short: '3 poin, maksimal 12 kata per poin',
    medium: '5 poin, maksimal 15 kata per poin',
  },
};

export const SKIP_TOKEN = '[SKIP]';
export const OUT_OF_CV_TOKEN = '[LUAR_CV]';

/**
 * Stable per-session prefix: rules + sources. The last block carries cache_control so the
 * whole system prompt is cached (and pre-warmed at session start).
 */
export function buildSystem(ctx: PromptContext): Anthropic.TextBlockParam[] {
  const [format, length] = SHAPE[ctx.format][ctx.length].split(', ');
  const rules = [
    'Kamu membantu kandidat menjawab pertanyaan interview secara live.',
    'SUMBER: hanya <cv>, <lowongan>, <analisis>, dan <percakapan>.',
    'ATURAN:',
    `1. Jika ucapan HR terakhir bukan pertanyaan atau permintaan yang perlu dijawab, balas persis: ${SKIP_TOKEN}`,
    '2. Jangan menambah pengalaman, angka, jabatan, tools, atau sertifikasi yang tidak tertulis di <cv>.',
    `3. Jika jawaban butuh hal di luar CV, awali dengan ${OUT_OF_CV_TOKEN}, lalu beri kerangka jawaban jujur tanpa mengarang.`,
    `4. Bahasa: ${LANGUAGE_LABEL[ctx.language]}. Format: ${format}. Panjang: ${length}.`,
    '5. Tanpa pembuka, tanpa penutup, tanpa mengulang pertanyaan.',
    'Jawaban ditulis sebagai kandidat (orang pertama), untuk dibaca sekilas sambil bicara.',
    ctx.format === 'bullets' ? 'Tulis setiap poin di baris baru diawali "- ".' : 'Tanpa markdown.',
  ].join('\n');

  const job = ctx.job;
  const sources = [
    `<cv>\n${ctx.cvText.trim()}\n</cv>`,
    `<lowongan>\nPerusahaan: ${job.company}\nPosisi: ${job.position}\n\n${job.description.trim()}${
      job.notes ? `\n\nCatatan kandidat: ${job.notes.trim()}` : ''
    }\n</lowongan>`,
    `<analisis>\n${ctx.analysis.trim() || '(belum ada analisis)'}\n</analisis>`,
  ].join('\n\n');

  return [
    { type: 'text', text: rules },
    { type: 'text', text: sources, cache_control: { type: 'ephemeral' } },
  ];
}

/** Volatile part: recent conversation + the HR utterance to answer. */
export function buildUserMessage(turns: Turn[], hrUtterance: string, force: boolean): string {
  const convo = turns.length
    ? turns.map((t) => `${t.speaker === 'hr' ? 'HR' : 'Kandidat'}: ${t.text}`).join('\n')
    : '(belum ada)';
  const parts = [
    `<percakapan>\n${convo}\n</percakapan>`,
    `Ucapan HR terakhir:\n<ucapan_hr>\n${hrUtterance}\n</ucapan_hr>`,
  ];
  if (force) parts.push(`Kandidat meminta jawaban untuk ucapan ini; jangan balas ${SKIP_TOKEN}.`);
  return parts.join('\n\n');
}
