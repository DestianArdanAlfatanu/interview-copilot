import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: result.error.issues.map((i) => i.message).join('; '),
      issues: result.error.issues,
    });
  }
  return result.data;
}
