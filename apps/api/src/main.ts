import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import { LiveGateway } from './live/live.gateway';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  app.enableCors({ origin: config.get('WEB_ORIGIN') });
  app.enableShutdownHooks();
  app.get(LiveGateway).attach(app.getHttpServer());

  const host = config.get('API_HOST');
  const port = config.get('API_PORT');
  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}`, 'Bootstrap');
}

void bootstrap();
