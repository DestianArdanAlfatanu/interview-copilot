import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(''),
  DEEPGRAM_API_KEY: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Anything other than "mock" means real Claude, so mock can never be left on by accident. */
  LIVE_LLM: z
    .string()
    .optional()
    .transform((v): 'claude' | 'mock' => (v?.trim().toLowerCase() === 'mock' ? 'mock' : 'claude')),
  MOCK_FIRST_TOKEN_MS: z.coerce.number().int().min(0).max(10_000).default(700),
  LIVE_MODEL: z.string().default('claude-haiku-5-5'),
  LIVE_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  LIVE_THINKING: z.enum(['disabled', 'adaptive']).default('disabled'),
  LIVE_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  LIVE_CONTEXT_TURNS: z.coerce.number().int().positive().default(12),
  PREP_MODEL: z.string().default('claude-sonnet-5-5'),
  DG_MODEL: z.string().default('nova-3'),
  DG_ENDPOINTING_MS: z.coerce.number().int().positive().default(300),
  DG_UTTERANCE_END_MS: z.coerce.number().int().min(1000).default(1000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
