import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { AnswerFormat, Language } from '@ic/shared';
import { AppConfig } from '../config/app-config.service';
import { MockLiveStream } from './mock-llm';

/** The slice of Anthropic's MessageStream that LiveSession relies on (also implemented by the mock). */
export interface LiveStream {
  on(event: 'text', listener: (delta: string) => void): unknown;
  finalMessage(): Promise<{ usage: Anthropic.Usage }>;
  abort(): void;
}

export interface LiveAsk {
  userText: string;
  /** Used by the mock only. */
  question: string;
  force: boolean;
  format: AnswerFormat;
  language: Language;
}

/** Holds the single Anthropic client (keep-alive connection reused across the session). */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  readonly client: Anthropic;
  /** LIVE_LLM=mock: no Claude calls at all; answers are simulated locally. */
  readonly isMock: boolean;

  constructor(private readonly config: AppConfig) {
    this.isMock = config.get('LIVE_LLM') === 'mock';
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY') || undefined,
      // We do exactly one retry ourselves (NFR), with visibility into it.
      maxRetries: 0,
      timeout: 30_000,
    });
    if (this.isMock) this.logger.warn('LIVE_LLM=mock — answers are simulated, Claude is not called');
  }

  get hasKey() {
    return Boolean(this.config.get('ANTHROPIC_API_KEY'));
  }

  private liveParams() {
    return {
      model: this.config.get('LIVE_MODEL'),
      thinking: { type: this.config.get('LIVE_THINKING') } as Anthropic.ThinkingConfigParam,
      output_config: { effort: this.config.get('LIVE_EFFORT') },
    };
  }

  streamLive(system: Anthropic.TextBlockParam[], ask: LiveAsk): LiveStream {
    if (this.isMock) {
      return new MockLiveStream({ ...ask, firstTokenMs: this.config.get('MOCK_FIRST_TOKEN_MS') });
    }
    return this.client.messages.stream({
      ...this.liveParams(),
      max_tokens: this.config.get('LIVE_MAX_TOKENS'),
      system,
      messages: [{ role: 'user', content: ask.userText }],
    });
  }

  /** SES-03: max_tokens 0 runs prefill only, writing the system-prompt cache. */
  async warmup(system: Anthropic.TextBlockParam[]) {
    if (this.isMock) return undefined;
    const t0 = Date.now();
    try {
      const res = await this.client.messages.create({
        ...this.liveParams(),
        max_tokens: 0,
        system,
        messages: [{ role: 'user', content: 'warmup' }],
      });
      this.logger.log(
        `cache warm-up ${Date.now() - t0} ms: write=${res.usage.cache_creation_input_tokens ?? 0} read=${
          res.usage.cache_read_input_tokens ?? 0
        }`,
      );
      return res.usage;
    } catch (err) {
      this.logger.warn(`cache warm-up failed: ${(err as Error).message}`);
      return undefined;
    }
  }
}
