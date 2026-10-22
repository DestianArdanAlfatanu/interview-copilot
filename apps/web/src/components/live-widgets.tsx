import { memo, useEffect, useRef } from 'react';
import { Check, Copy, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SttState } from '@ic/shared';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AnswerCardState, TranscriptLine } from '@/live/store';

const STT_LABEL: Record<SttState, string> = {
  connecting: 'Menyambung…',
  live: 'Live',
  reconnecting: 'Menyambung ulang…',
  failed: 'Putus',
};

const STT_DOT: Record<SttState, string> = {
  connecting: 'bg-muted-foreground',
  live: 'bg-success',
  reconnecting: 'bg-warning animate-pulse',
  failed: 'bg-destructive',
};

export function StatusPill({ label, state }: { label: string; state: SttState }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
      <span className={cn('size-2 rounded-full', STT_DOT[state])} />
      {label}: {STT_LABEL[state]}
    </span>
  );
}

/** RMS level bar. Level arrives ~10×/s; the bar is driven by a ref to avoid re-renders. */
export function AudioMeter({ subscribe, label }: { subscribe: (cb: (level: number) => void) => () => void; label: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      subscribe((level) => {
        // Speech RMS sits around 0.02–0.2; map log-ish to 0–100%.
        const pct = Math.min(100, Math.max(0, (Math.log10(level + 1e-4) + 3.3) * 40));
        if (bar.current) bar.current.style.width = `${pct}%`;
      }),
    [subscribe],
  );
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-10 shrink-0">{label}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div ref={bar} className="h-full w-0 rounded-full bg-success transition-[width] duration-100" />
      </div>
    </div>
  );
}

export const TranscriptLineView = memo(function TranscriptLineView({
  line,
  interim,
}: {
  line: Pick<TranscriptLine, 'speaker' | 'text'>;
  interim?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm leading-relaxed">
      <span
        className={cn(
          'mt-0.5 w-12 shrink-0 text-xs font-semibold uppercase',
          line.speaker === 'hr' ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {line.speaker === 'hr' ? 'HR' : 'Saya'}
      </span>
      <p className={cn(interim && 'text-muted-foreground/70 italic')}>{line.text}</p>
    </div>
  );
});

export const AnswerCard = memo(function AnswerCard({
  answer,
  latest,
  onRegenerate,
  onDismiss,
}: {
  answer: AnswerCardState;
  latest: boolean;
  onRegenerate: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(answer.text);
    toast.success('Jawaban disalin');
  };

  return (
    <article
      className={cn(
        'rounded-lg border bg-card p-4 shadow-sm transition-opacity',
        latest ? 'border-l-4 border-l-primary' : 'opacity-60 hover:opacity-100',
        answer.status === 'aborted' && 'opacity-40',
      )}
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{answer.question}</p>
        <div className="flex shrink-0 items-center gap-1">
          {answer.mock && (
            <Badge variant="mock" title="LIVE_LLM=mock — jawaban simulasi, bukan dari Claude">
              MOCK
            </Badge>
          )}
          {answer.outOfCv && <Badge variant="warning">Tidak ada di CV</Badge>}
          {answer.manual && <Badge variant="secondary">Manual</Badge>}
          {answer.latency?.firstWordMs !== undefined && (
            <Badge variant="outline" title="Akhir ucapan HR → kata pertama tampil">
              {(answer.latency.firstWordMs / 1000).toFixed(1)} dtk
            </Badge>
          )}
        </div>
      </header>

      {answer.status === 'error' ? (
        <p className="text-[18px] text-destructive">{answer.error ?? 'Gagal membuat jawaban.'}</p>
      ) : (
        <div className="whitespace-pre-wrap text-[18px] leading-relaxed">
          {answer.text}
          {answer.status === 'streaming' && (
            <span className="ml-0.5 inline-block h-5 w-2 animate-pulse bg-primary align-middle" />
          )}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={copy} disabled={!answer.text}>
          <Copy /> Salin
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onRegenerate(answer.id)}>
          <RotateCcw /> {answer.status === 'error' ? 'Coba lagi' : 'Ulang'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDismiss(answer.id)}>
          <X /> Abaikan
        </Button>
        {answer.status === 'aborted' && <span className="ml-auto text-xs text-muted-foreground">dibatalkan</span>}
        {answer.status === 'done' && (
          <Check className="ml-auto size-4 text-success" aria-label="selesai" />
        )}
      </footer>
    </article>
  );
});
