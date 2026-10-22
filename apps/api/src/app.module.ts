import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CvModule } from './cv/cv.module';
import { JobsModule } from './jobs/jobs.module';
import { SessionsModule } from './sessions/sessions.module';
import { LiveModule } from './live/live.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AppConfigModule, PrismaModule, CvModule, JobsModule, SessionsModule, LiveModule],
  controllers: [HealthController],
})
export class AppModule {}
