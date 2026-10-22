import type { AnswerFormat, AnswerLength, Language } from '@ic/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Server lokal tidak berjalan. Jalankan `npm run dev` lalu muat ulang.', 0);
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = body?.message;
    throw new ApiError(Array.isArray(msg) ? msg.join('; ') : msg ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export interface Cv {
  id: string;
  name: string;
  extractedText: string;
  isActive: boolean;
  createdAt: string;
}

export interface Job {
  id: string;
  company: string;
  position: string;
  description: string;
  notes: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  cvId: string;
  jobId: string;
  language: Language;
  answerFormat: AnswerFormat;
  answerLength: AnswerLength;
  status: 'setup' | 'live' | 'paused' | 'ended';
  job?: { company: string; position: string };
}

export interface Health {
  ok: boolean;
  anthropicKey: boolean;
  deepgramKey: boolean;
  liveModel: string;
  liveLlm: 'claude' | 'mock';
}

export const api = {
  health: () => request<Health>('/api/health'),
  listCv: () => request<Cv[]>('/api/cv'),
  createCv: (input: { name: string; text: string }) =>
    request<Cv>('/api/cv', { method: 'POST', body: JSON.stringify(input) }),
  listJobs: () => request<Job[]>('/api/jobs'),
  createJob: (input: { company: string; position: string; description: string; notes?: string }) =>
    request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(input) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  createSession: (input: {
    cvId: string;
    jobId: string;
    language: Language;
    answerFormat: AnswerFormat;
    answerLength: AnswerLength;
  }) => request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify(input) }),
};
