import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config.service';
import { LiveGateway } from './live/live.gateway';

/**
 * `--serve-web` (npm run start:local): also serve the built frontend from this process, so a
 * real interview runs on one Node process with no Vite and no watchers.
 */
const SERVE_WEB = process.argv.includes('--serve-web');
const WEB_DIST = resolve(__dirname, '../../web/dist');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(AppConfig);
  const host = config.get('API_HOST');
  const port = config.get('API_PORT');

  app.enableCors({ origin: config.get('WEB_ORIGIN') });
  app.enableShutdownHooks();

  // The page is then served from this port, so its WebSocket origin is this server's own.
  const ownOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  app.get(LiveGateway).attach(app.getHttpServer(), SERVE_WEB ? ownOrigins : []);

  if (SERVE_WEB) {
    const index = join(WEB_DIST, 'index.html');
    if (!existsSync(index)) {
      throw new Error(`Frontend build not found at ${WEB_DIST}. Run "npm run start:local" from the repo root.`);
    }
    app.useStaticAssets(WEB_DIST, { index: false });
    // SPA fallback: client routes like /session/:id get index.html; /api and /ws stay with Nest.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(index);
    });
  }

  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}`, 'Bootstrap');
  if (SERVE_WEB) Logger.log(`Interview Copilot siap: buka http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
