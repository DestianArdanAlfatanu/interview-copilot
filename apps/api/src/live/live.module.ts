import { Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { LlmService } from './llm.service';

@Module({
  providers: [LiveGateway, LlmService],
  exports: [LiveGateway],
})
export class LiveModule {}
