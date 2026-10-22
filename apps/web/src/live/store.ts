import { create } from 'zustand';
import type { AnswerLatencyPayload, LatencySummary, ServerEvent, SttState, Speaker } from '@ic/shared';

export interface TranscriptLine {
  id: number;
  speaker: Speaker;
  text: string;
  startMs: number;
}

export type AnswerStatus = 'streaming' | 'done' | 'aborted' | 'error';

export interface AnswerCardState {
  id: string;
  question: string;
  text: string;
  status: AnswerStatus;
  outOfCv: boolean;
  manual: boolean;
  mock: boolean;
  dismissed: boolean;
  latency?: AnswerLatencyPayload;
  error?: string;
}

export interface LatencySample extends AnswerLatencyPayload {
  answerId: string;
  mock: boolean;
}

interface LiveState {
  connection: 'idle' | 'connecting' | 'open' | 'closed' | 'failed';
  stt: Record<Speaker, SttState>;
  finals: TranscriptLine[];
  interim: Record<Speaker, { text: string; startMs: number } | null>;
  answers: AnswerCardState[]; // newest first
  paused: boolean;
  ended: boolean;
  costUsd: number;
  p50?: number;
  p90?: number;
  questions: number;
  /** LIVE_LLM=mock: true once the server says so. */
  mock: boolean;
  mockLatency: LatencySummary;
  latencies: LatencySample[];
  serverError?: string;

  reset(): void;
  setConnection(c: LiveState['connection']): void;
  apply(e: ServerEvent): void;
  appendDeltas(deltas: Map<string, string>): void;
  dismiss(answerId: string): void;
}

const initial = () => ({
  connection: 'idle' as const,
  stt: { hr: 'connecting', user: 'connecting' } as Record<Speaker, SttState>,
  finals: [] as TranscriptLine[],
  interim: { hr: null, user: null },
  answers: [] as AnswerCardState[],
  paused: false,
  ended: false,
  costUsd: 0,
  p50: undefined,
  p90: undefined,
  questions: 0,
  mock: false,
  mockLatency: { measured: 0 } as LatencySummary,
  latencies: [] as LatencySample[],
  serverError: undefined,
});

let lineId = 0;
const MAX_FINALS = 400;
const MAX_ANSWERS = 60;

function patchAnswer(answers: AnswerCardState[], id: string, patch: Partial<AnswerCardState>) {
  return answers.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

export const useLive = create<LiveState>()((set) => ({
  ...initial(),

  reset: () => set(initial()),
  setConnection: (connection) => set({ connection }),

  apply: (e) =>
    set((s) => {
      switch (e.type) {
        case 'transcript': {
          if (!e.isFinal) return { interim: { ...s.interim, [e.speaker]: { text: e.text, startMs: e.startMs } } };
          const finals = [...s.finals, { id: ++lineId, speaker: e.speaker, text: e.text, startMs: e.startMs }];
          if (finals.length > MAX_FINALS) finals.splice(0, finals.length - MAX_FINALS);
          return { finals, interim: { ...s.interim, [e.speaker]: null } };
        }
        case 'stt.status':
          return { stt: { ...s.stt, [e.channel]: e.state } };
        case 'answer.start': {
          const existing = s.answers.find((a) => a.id === e.answerId);
          const card: AnswerCardState = {
            id: e.answerId,
            question: e.questionText,
            text: '',
            status: 'streaming',
            outOfCv: false,
            manual: e.manual,
            mock: e.mock,
            dismissed: false,
          };
          // Regenerate reuses the id: replace the card and move it to the top.
          const rest = existing ? s.answers.filter((a) => a.id !== e.answerId) : s.answers;
          return { answers: [card, ...rest].slice(0, MAX_ANSWERS) };
        }
        case 'answer.done':
          return {
            answers: patchAnswer(s.answers, e.answerId, { status: 'done', outOfCv: e.outOfCv, latency: e.latency }),
          };
        case 'answer.aborted':
          return { answers: patchAnswer(s.answers, e.answerId, { status: 'aborted' }) };
        case 'answer.error':
          return { answers: patchAnswer(s.answers, e.answerId, { status: 'error', error: e.message }) };
        case 'answer.skipped':
          return {};
        case 'session.metrics':
          return {
            costUsd: e.costUsd,
            p50: e.latencyP50Ms,
            p90: e.latencyP90Ms,
            questions: e.questions,
            mockLatency: e.mockLatency,
            latencies: e.lastLatency ? [e.lastLatency, ...s.latencies].slice(0, 50) : s.latencies,
          };
        case 'session.ready':
          return { mock: e.mock };
        case 'session.paused':
          return { paused: true };
        case 'session.resumed':
          return { paused: false };
        case 'session.ended':
          return { ended: true };
        case 'error':
          return { serverError: e.message };
        default:
          return {};
      }
    }),

  appendDeltas: (deltas) =>
    set((s) => ({
      answers: s.answers.map((a) => {
        const d = deltas.get(a.id);
        return d ? { ...a, text: a.text + d } : a;
      }),
    })),

  dismiss: (answerId) => set((s) => ({ answers: patchAnswer(s.answers, answerId, { dismissed: true }) })),
}));
