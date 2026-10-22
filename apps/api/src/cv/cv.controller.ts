import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { parseBody } from '../common/zod-body';

const createCvSchema = z.object({
  name: z.string().trim().min(1).max(191),
  text: z.string().trim().min(50, 'Teks CV terlalu pendek.'),
});

/** M0: paste-only CV. PDF upload, versions UI and editing land in M1. */
@Controller('api/cv')
export class CvController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.cvProfile.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const cv = await this.prisma.cvProfile.findUnique({ where: { id } });
    if (!cv) throw new NotFoundException();
    return cv;
  }

  @Post()
  async create(@Body() body: unknown) {
    const input = parseBody(createCvSchema, body);
    // Exactly one active CV (CV-03): the newest one becomes active.
    return this.prisma.$transaction(async (tx) => {
      await tx.cvProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.cvProfile.create({
        data: { name: input.name, extractedText: input.text, isActive: true },
      });
    });
  }
}
