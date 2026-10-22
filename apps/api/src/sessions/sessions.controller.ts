import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  ANSWER_FORMATS,
  ANSWER_LENGTHS,
  LANGUAGES,
  MAX_KEYTERM_CHARS,
  MAX_MANUAL_KEYTERMS,
  firstWordLatencyMs,
  summarize,
  type AnswerLatency,
} from '@ic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseBody } from '../common/zod-body';

const createSessionSchema = z.object({
  cvId: z.string().uuid(),
  jobId: z.string().uuid(),
  language: z.enum(LANGUAGES),
  answerFormat: z.enum(ANSWER_FORMATS),
  answerLength: z.enum(ANSWER_LENGTHS),
  /** Extra Deepgram keyterms typed in setup; auto-extracted ones are added at session start. */
  keyterms: z
    .array(z.string().trim().min(1).max(MAX_KEYTERM_CHARS, `Istilah maksimal ${MAX_KEYTERM_CHARS} karakter.`))
    .max(MAX_MANUAL_KEYTERMS, `Maksimal ${MAX_MANUAL_KEYTERMS} istilah tambahan.`)
    .default([]),
});

@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      include: { job: { select: { company: true, position: true } } },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { job: { select: { company: true, position: true } } },
    });
    if (!session) throw new NotFoundException();
    return session;
  }

  @Post()
  async create(@Body() body: unknown) {
    const input = parseBody(createSessionSchema, body);
    const [cv, job] = await Promise.all([
      this.prisma.cvProfile.findUnique({ where: { id: input.cvId } }),
      this.prisma.job.findUnique({ where: { id: input.jobId } }),
    ]);
    if (!cv || !job) throw new NotFoundException('CV atau lowongan tidak ditemukan.');
    const { keyterms, ...data } = input;
    return this.prisma.session.create({ data: { ...data, keyterms: { manual: keyterms } } });
  }

  /**
   * POC gate report: first-word latency over auto-detected (non-manual) answers.
   * Mock-mode answers (LIVE_LLM=mock) are summarized separately and never count toward p50/p90.
   */
  @Get(':id/latency')
  async latency(@Param('id') id: string) {
    const answers = await this.prisma.answer.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
    const rows = answers.map((a) => {
      const l = (a.latencyJson ?? {}) as AnswerLatency;
      return {
        id: a.id,
        status: a.status,
        manual: Boolean(l.manual),
        mock: Boolean(l.mock),
        question: a.questionText,
        firstWordMs: firstWordLatencyMs(l),
        inputTokens: a.inputTokens,
        cachedTokens: a.cachedTokens,
        outputTokens: a.outputTokens,
      };
    });
    const samples = (mock: boolean) =>
      rows
        .filter((r) => r.mock === mock && r.status === 'done' && !r.manual && r.firstWordMs !== undefined)
        .map((r) => r.firstWordMs as number);
    const real = rows.filter((r) => !r.mock);
    const mock = rows.filter((r) => r.mock);
    return {
      answered: real.filter((r) => r.status === 'done').length,
      skipped: real.filter((r) => r.status === 'skipped').length,
      ...summarize(samples(false)),
      mock: {
        answered: mock.filter((r) => r.status === 'done').length,
        skipped: mock.filter((r) => r.status === 'skipped').length,
        ...summarize(samples(true)),
      },
      rows,
    };
  }
}
