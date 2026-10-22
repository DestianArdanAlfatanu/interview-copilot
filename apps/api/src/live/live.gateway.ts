import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Language, AnswerFormat, AnswerLength } from '@ic/shared';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from './llm.service';
import { LiveSession } from './live-session';
import { extractKeyterms, mergeKeyterms } from './keyterms';

const PATH_RE = /^\/ws\/session\/([0-9a-f-]{36})$/i;

/**
 * Raw `ws` server on Nest's HTTP server: one socket per live session at /ws/session/:id.
 * (Nest's WS gateways don't route on path params, so upgrades are handled here.)
 */
@Injectable()
export class LiveGateway implements OnModuleDestroy {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  private readonly sessions = new Map<string, LiveSession>();

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** extraOrigins: when the API also serves the frontend (start:local), its own origin(s). */
  attach(server: Server, extraOrigins: string[] = []) {
    const allowed = new Set([this.config.get('WEB_ORIGIN'), ...extraOrigins]);
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? '').split('?')[0];
      const match = PATH_RE.exec(path);
      if (!match) return; // not ours
      if (!allowed.has(req.headers.origin ?? '')) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.onConnection(ws, match[1]));
    });
  }

  private async onConnection(ws: WebSocket, sessionId: string) {
    ws.binaryType = 'nodebuffer';
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { cv: true, job: true, prep: true },
    });
    if (!session || session.status === 'ended') {
      ws.send(JSON.stringify({ type: 'error', code: 'session_not_found', message: 'Sesi tidak ditemukan atau sudah berakhir.' }));
      ws.close(4404, 'not found');
      return;
    }

    const previous = this.sessions.get(sessionId);
    if (previous) await previous.replace();
    const fresh = previous
      ? await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
      : session;

    // Keyterm prompting: manual terms from setup first, then terms extracted from CV + job.
    const stored = (session.keyterms ?? {}) as { manual?: string[] };
    const manual = stored.manual ?? [];
    const job = session.job;
    const auto = extractKeyterms([
      session.cv.extractedText,
      [job.company, job.position, job.description, job.notes ?? ''].join('\n'),
    ]);
    const keyterms = mergeKeyterms(manual, auto);
    this.logger.log(`keyterms (${manual.length} manual + ${auto.length} auto → ${keyterms.length}): ${keyterms.join(', ')}`);
    void this.prisma.session
      .update({ where: { id: sessionId }, data: { keyterms: { manual, auto } } })
      .catch((err) => this.logger.error(`saving keyterms failed: ${(err as Error).message}`));

    const live = new LiveSession(
      sessionId,
      ws,
      {
        language: session.language as Language,
        format: session.answerFormat as AnswerFormat,
        length: session.answerLength as AnswerLength,
        cvText: session.cv.extractedText,
        job: session.job,
        analysis: '', // M1: prep analysis + answer bank
      },
      { config: this.config, llm: this.llm, prisma: this.prisma },
      { sttSecondsHr: fresh.sttSecondsHr, sttSecondsUser: fresh.sttSecondsUser },
      keyterms,
    );
    this.sessions.set(sessionId, live);
    ws.on('close', () => {
      if (this.sessions.get(sessionId) === live) this.sessions.delete(sessionId);
    });
    live.start();
    this.logger.log(`session ${sessionId} connected`);
  }

  onModuleDestroy() {
    for (const ws of this.wss.clients) ws.close(1001, 'server shutdown');
  }
}
