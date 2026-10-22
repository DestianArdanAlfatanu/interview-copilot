import { Controller, Get } from '@nestjs/common';
import { AppConfig } from './config/app-config.service';

@Controller('api/health')
export class HealthController {
  constructor(private readonly config: AppConfig) {}

  /** Never returns key values (SET-01), only whether they're set. */
  @Get()
  health() {
    return {
      ok: true,
      anthropicKey: Boolean(this.config.get('ANTHROPIC_API_KEY')),
      deepgramKey: Boolean(this.config.get('DEEPGRAM_API_KEY')),
      liveModel: this.config.get('LIVE_MODEL'),
      liveLlm: this.config.get('LIVE_LLM'),
    };
  }
}
