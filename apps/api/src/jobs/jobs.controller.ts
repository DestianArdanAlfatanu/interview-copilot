import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { JOB_DESCRIPTION_MIN_CHARS } from '@ic/shared';
import { PrismaService } from '../prisma/prisma.service';
import { parseBody } from '../common/zod-body';

const createJobSchema = z.object({
  company: z.string().trim().min(1).max(191),
  position: z.string().trim().min(1).max(191),
  description: z
    .string()
    .trim()
    .min(JOB_DESCRIPTION_MIN_CHARS, 'Deskripsi terlalu pendek. Tempel deskripsi lowongan lengkap.'),
  notes: z.string().trim().max(5000).optional(),
});

@Controller('api/jobs')
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    return job;
  }

  @Post()
  create(@Body() body: unknown) {
    return this.prisma.job.create({ data: parseBody(createJobSchema, body) });
  }
}
