import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnv } from './env';
import { AppConfig } from './app-config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // The single .env lives at the monorepo root.
      envFilePath: [resolve(__dirname, '../../../../.env'), resolve(process.cwd(), '.env')],
      validate: validateEnv,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
