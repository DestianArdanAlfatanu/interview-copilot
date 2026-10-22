import Anthropic from '@anthropic-ai/sdk';
import type { AnswerFormat, Language } from '@ic/shared';
import { SKIP_TOKEN } from './prompt';
import { looksLikeQuestion } from './question-heuristic';
import type { LiveStream } from './llm.service';

const WORD_INTERVAL_MS = 35;

const ZERO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as Anthropic.Usage;

function mockText(question: string, format: AnswerFormat, language: Language): string {
  const q = question.length > 60 ? `${question.slice(0, 57)}…` : question;
  if (language === 'en') {
    return format === 'bullets'
      ? `- Mock point one for "${q}"\n- Mock point two, no AI involved\n- Mock point three to test the layout`
      : `Mock answer for "${q}". This text is generated locally to test turn detection, streaming and latency without calling Claude.`;
  }
  return format === 'bullets'
    ? `- Poin mock pertama untuk "${q}"\n- Poin mock kedua, tanpa AI\n- Poin mock ketiga untuk tes tampilan`
    : `Jawaban mock untuk "${q}". Teks ini dibuat lokal untuk menguji deteksi giliran, streaming, dan latency tanpa memanggil Claude.`;
}

/**
 * Drop-in for the Anthropic MessageStream surface LiveSession uses (on('text'), finalMessage,
 * abort). Waits firstTokenMs, then streams word by word; non-questions get [SKIP].
 */
export class MockLiveStream implements LiveStream {
  private listeners: Array<(delta: string) => void> = [];
  private timers: NodeJS.Timeout[] = [];
  private settle!: { resolve: (m: { usage: Anthropic.Usage }) => void; reject: (e: unknown) => void };
  private readonly done: Promise<{ usage: Anthropic.Usage }>;

  constructor(opts: { question: string; force: boolean; format: AnswerFormat; language: Language; firstTokenMs: number }) {
    this.done = new Promise((resolve, reject) => (this.settle = { resolve, reject }));
    // Unhandled until someone awaits finalMessage(); avoid process-level warnings on abort.
    this.done.catch(() => undefined);

    const text =
      opts.force || looksLikeQuestion(opts.question) ? mockText(opts.question, opts.format, opts.language) : SKIP_TOKEN;
    const chunks = text.split(/(?<=\s)/);
    chunks.forEach((chunk, i) => {
      this.timers.push(setTimeout(() => this.listeners.forEach((l) => l(chunk)), opts.firstTokenMs + i * WORD_INTERVAL_MS));
    });
    this.timers.push(
      setTimeout(() => this.settle.resolve({ usage: ZERO_USAGE }), opts.firstTokenMs + chunks.length * WORD_INTERVAL_MS),
    );
  }

  on(_event: 'text', listener: (delta: string) => void) {
    this.listeners.push(listener);
    return this;
  }

  finalMessage() {
    return this.done;
  }

  abort() {
    this.timers.forEach(clearTimeout);
    this.listeners = [];
    this.settle.reject(new Anthropic.APIUserAbortError());
  }
}
