import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronDown, Mic, MonitorUp, Pause, Play, Power, RefreshCw, Send } from 'lucide-react';
import type { MicVAD } from '@ricky0123/vad-web';
import { AUDIO_CHANNEL, type AudioChannel } from '@ic/shared';
import { api } from '@/lib/api';
import { cn, formatDuration, formatUsd } from '@/lib/utils';
import { AudioPipeline, CaptureError, captureMic, captureTabAudio, isSupportedBrowser } from '@/audio/capture';
import { startUserVad } from '@/audio/vad';
import { LiveConnection } from '@/live/connection';
import { useLive } from '@/live/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input, Kbd } from '@/components/ui/form-controls';
import { AnswerCard, AudioMeter, StatusPill, TranscriptLineView } from '@/components/live-widgets';

type LevelCb = (level: number) => void;

const fmtSec = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}s`);

/** Tiny pub-sub so meters update without React re-renders. */
function useLevelBus() {
  return useMemo(() => {
    const subs: Record<AudioChannel, Set<LevelCb>> = { 0: new Set(), 1: new Set() };
    return {
      emit: (ch: AudioChannel, level: number) => subs[ch].forEach((cb) => cb(level)),
      subscribe: (ch: AudioChannel) => (cb: LevelCb) => {
        subs[ch].add(cb);
        return () => void subs[ch].delete(cb);
      },
    };
  }, []);
}

export function SessionPage() {
  const { id = '' } = useParams();
  const session = useQuery({ queryKey: ['session', id], queryFn: () => api.getSession(id) });

  const pipeline = useRef<AudioPipeline>();
  const conn = useRef<LiveConnection>();
  const vad = useRef<MicVAD>();
  const tabStream = useRef<MediaStream>();
  const micStream = useRef<MediaStream>();
  const levels = useLevelBus();
  const subscribeHr = useMemo(() => levels.subscribe(AUDIO_CHANNEL.HR), [levels]);
  const subscribeUser = useMemo(() => levels.subscribe(AUDIO_CHANNEL.USER), [levels]);

  const [tabReady, setTabReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [captureError, setCaptureError] = useState<string>();
  const [phase, setPhase] = useState<'capture' | 'live'>('capture');
  const [hrLost, setHrLost] = useState(false);
  const [liveSince, setLiveSince] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [manual, setManual] = useState('');
  const [showLatency, setShowLatency] = useState(true);
  const manualInput = useRef<HTMLInputElement>(null);

  const live = useLive();

  useEffect(() => {
    useLive.getState().reset();
    pipeline.current = new AudioPipeline();
    pipeline.current.onLevel = levels.emit;
    return () => {
      conn.current?.close();
      void vad.current?.destroy();
      void pipeline.current?.close();
      tabStream.current?.getTracks().forEach((t) => t.stop());
      micStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [levels]);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const shareTab = useCallback(async () => {
    setCaptureError(undefined);
    try {
      const stream = await captureTabAudio();
      tabStream.current?.getTracks().forEach((t) => t.stop());
      tabStream.current = stream;
      // AUD-05: tab closed / reloaded / sharing stopped.
      stream.getAudioTracks()[0].addEventListener('ended', () => setHrLost(true));
      await pipeline.current!.attach(AUDIO_CHANNEL.HR, stream);
      setTabReady(true);
      setHrLost(false);
    } catch (err) {
      setCaptureError(err instanceof CaptureError ? err.message : String(err));
    }
  }, []);

  const enableMic = useCallback(async () => {
    setCaptureError(undefined);
    try {
      const stream = await captureMic();
      micStream.current = stream;
      await pipeline.current!.attach(AUDIO_CHANNEL.USER, stream);
      setMicReady(true);
    } catch (err) {
      setCaptureError(err instanceof CaptureError ? err.message : String(err));
    }
  }, []);

  const goLive = useCallback(async () => {
    const c = new LiveConnection(id);
    conn.current = c;
    try {
      await c.connect();
    } catch {
      setCaptureError('Server lokal tidak berjalan. Jalankan `npm run dev` lalu muat ulang.');
      return;
    }
    pipeline.current!.sink = c.sendAudio;
    try {
      vad.current = await startUserVad(micStream.current!, (state) =>
        c.send({ type: 'vad.user', state, t: Date.now() }),
      );
    } catch (err) {
      console.error('VAD failed to start', err);
    }
    setLiveSince(Date.now());
    setPhase('live');
  }, [id]);

  const latestAnswer = live.answers.find((a) => !a.dismissed);

  const togglePause = useCallback(() => {
    const paused = useLive.getState().paused;
    conn.current?.send({ type: paused ? 'session.resume' : 'session.pause' });
  }, []);

  const endSession = useCallback(() => {
    if (!window.confirm('Akhiri sesi? Transkrip berhenti dan sesi disimpan ke riwayat.')) return;
    conn.current?.send({ type: 'session.end' });
    void vad.current?.pause();
    if (pipeline.current) pipeline.current.sink = undefined;
  }, []);

  const regenerate = useCallback((answerId: string) => conn.current?.send({ type: 'control.regenerate', answerId }), []);
  const dismiss = useCallback((answerId: string) => {
    const a = useLive.getState().answers.find((x) => x.id === answerId);
    if (a?.status === 'streaming') conn.current?.send({ type: 'control.cancel', answerId });
    useLive.getState().dismiss(answerId);
  }, []);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const text = manual.trim();
    if (!text) return;
    conn.current?.send({ type: 'control.manual_question', text });
    setManual('');
    manualInput.current?.blur();
  };

  // HK-01: Space answer now, Esc dismiss, R regenerate, / focus manual input, P pause.
  useEffect(() => {
    if (phase !== 'live') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const latest = useLive.getState().answers.find((a) => !a.dismissed);
      switch (e.key) {
        case ' ':
          e.preventDefault();
          conn.current?.send({ type: 'control.answer_now' });
          break;
        case 'Escape':
          if (latest) dismiss(latest.id);
          break;
        case 'r':
        case 'R':
          if (latest) regenerate(latest.id);
          break;
        case '/':
          e.preventDefault();
          manualInput.current?.focus();
          break;
        case 'p':
        case 'P':
          togglePause();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, dismiss, regenerate, togglePause]);

  // Auto-scroll transcript.
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [live.finals.length, live.interim.hr, live.interim.user]);

  if (session.isError) {
    return (
      <main className="container max-w-xl py-16">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Sesi tidak ditemukan. <Link to="/" className="underline">Kembali</Link></AlertDescription>
        </Alert>
      </main>
    );
  }

  if (phase === 'capture') {
    return (
      <main className="container max-w-2xl space-y-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Siapkan audio</CardTitle>
            <CardDescription>
              {session.data?.job ? `${session.data.job.position} — ${session.data.job.company}` : 'Memuat…'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isSupportedBrowser() && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>Capture audio tab hanya didukung Chrome dan Edge desktop.</AlertDescription>
              </Alert>
            )}
            {captureError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{captureError}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="font-medium">1. Bagikan tab interview</p>
                <p className="text-sm text-muted-foreground">Pilih tab Meet/Zoom/Teams, centang “Also share tab audio”.</p>
              </div>
              <div className="flex items-center gap-3">
                {tabReady && <AudioMeter label="HR" subscribe={subscribeHr} />}
                <Button variant={tabReady ? 'outline' : 'default'} onClick={shareTab}>
                  <MonitorUp /> {tabReady ? 'Pilih ulang tab' : 'Bagikan tab'}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="font-medium">2. Izinkan mikrofon</p>
                <p className="text-sm text-muted-foreground">Dipakai untuk transkrip suara Anda dan deteksi giliran bicara.</p>
              </div>
              <div className="flex items-center gap-3">
                {micReady && <AudioMeter label="Saya" subscribe={subscribeUser} />}
                <Button variant={micReady ? 'outline' : 'default'} onClick={enableMic} disabled={micReady}>
                  <Mic /> {micReady ? 'Mic aktif' : 'Izinkan mic'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="lg" disabled={!tabReady || !micReady} onClick={goLive}>
                <Play /> Mulai sesi
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const sttProblem = live.stt.hr === 'failed' || live.stt.user === 'failed';
  const noHrYet = now - liveSince > 60_000 && !live.finals.some((l) => l.speaker === 'hr');

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        {live.mock && (
          <Badge variant="mock" title="LIVE_LLM=mock di .env — Claude tidak dipanggil">
            MODE MOCK
          </Badge>
        )}
        <StatusPill label="HR" state={live.stt.hr} />
        <StatusPill label="Saya" state={live.stt.user} />
        <AudioMeter label="HR" subscribe={subscribeHr} />
        <AudioMeter label="Saya" subscribe={subscribeUser} />
        <div className="ml-auto flex items-center gap-4 text-sm tabular-nums">
          <span title="Durasi">{formatDuration(now - liveSince)}</span>
          <span title="Biaya berjalan" className="text-muted-foreground">{formatUsd(live.costUsd)}</span>
          <span title="Latency kata pertama p50 / p90" className="text-muted-foreground">
            p50 {live.p50 !== undefined ? `${(live.p50 / 1000).toFixed(1)}s` : '–'} · p90{' '}
            {live.p90 !== undefined ? `${(live.p90 / 1000).toFixed(1)}s` : '–'} ({live.questions})
          </span>
          {live.mock && (
            <span title="Latency jawaban mock — terpisah, tidak dihitung di p50/p90" className="text-fuchsia-600 dark:text-fuchsia-300">
              mock p50 {fmtSec(live.mockLatency.p50Ms)} · p90 {fmtSec(live.mockLatency.p90Ms)} ({live.mockLatency.measured})
            </span>
          )}
          <Button variant="outline" size="sm" onClick={togglePause} disabled={live.ended}>
            {live.paused ? <Play /> : <Pause />} {live.paused ? 'Lanjut' : 'Pause'}
          </Button>
          <Button variant="destructive" size="sm" onClick={endSession} disabled={live.ended}>
            <Power /> Akhiri
          </Button>
        </div>
      </header>

      <div className="space-y-2 px-4 empty:hidden [&:not(:empty)]:pt-2">
        {live.connection !== 'open' && !live.ended && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="flex items-center gap-3">
              Server lokal tidak berjalan. Jalankan `npm run dev` lalu muat ulang.
              <Button size="sm" variant="outline" onClick={() => location.reload()}>Muat ulang</Button>
            </AlertDescription>
          </Alert>
        )}
        {hrLost && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="flex items-center gap-3">
              Audio HR terputus.
              <Button size="sm" variant="outline" onClick={shareTab}>
                <RefreshCw /> Sambungkan ulang tab
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {sttProblem && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>Transkrip berhenti. Ketik pertanyaan secara manual sambil kami mencoba lagi.</AlertDescription>
          </Alert>
        )}
        {live.serverError && (
          <Alert variant="warning">
            <AlertCircle />
            <AlertDescription>{live.serverError}</AlertDescription>
          </Alert>
        )}
        {live.ended && (
          <Alert>
            <AlertDescription>
              Sesi selesai dan disimpan. <Link to="/" className="underline">Sesi baru</Link>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-[2fr_3fr]">
        <section className="min-h-0 overflow-y-auto border-r p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transkrip</h2>
          <div className="space-y-2">
            {live.finals.map((l) => (
              <TranscriptLineView key={l.id} line={l} />
            ))}
            {(['hr', 'user'] as const).map(
              (sp) => live.interim[sp] && <TranscriptLineView key={sp} line={{ speaker: sp, text: live.interim[sp]!.text }} interim />,
            )}
            {noHrYet && (
              <p className="text-sm text-muted-foreground">
                Belum ada suara dari tab. Pastikan tab yang dibagikan adalah tab interview.{' '}
                <button className="underline" onClick={shareTab}>Pilih ulang tab</button>
              </p>
            )}
            <div ref={transcriptEnd} />
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {live.answers.filter((a) => !a.dismissed).length === 0 && (
              <p className="pt-10 text-center text-sm text-muted-foreground">
                Jawaban muncul di sini saat HR bertanya. Tekan <Kbd>Space</Kbd> untuk menjawab sekarang.
              </p>
            )}
            {live.answers
              .filter((a) => !a.dismissed)
              .map((a) => (
                <AnswerCard
                  key={a.id}
                  answer={a}
                  latest={a.id === latestAnswer?.id}
                  onRegenerate={regenerate}
                  onDismiss={dismiss}
                />
              ))}
          </div>

          <div className="border-t">
            <button
              className="flex w-full items-center gap-1 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowLatency((v) => !v)}
            >
              <ChevronDown className={cn('size-3 transition-transform', !showLatency && '-rotate-90')} />
              Latency per tahap (ms, dari akhir ucapan HR)
            </button>
            {showLatency && (
              <div className="max-h-32 overflow-y-auto px-4 pb-2">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="font-normal">turn ditutup</th>
                      <th className="font-normal">request</th>
                      <th className="font-normal">token pertama</th>
                      <th className="font-normal">tampil</th>
                      <th className="font-normal">selesai</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {live.latencies.map((l) => (
                      <tr key={l.answerId}>
                        <td>{l.stages.turnClosed ?? '–'}</td>
                        <td>{l.stages.requestSent ?? '–'}</td>
                        <td>{l.stages.firstToken ?? '–'}</td>
                        <td className="font-semibold">{l.stages.firstTokenRendered ?? '–'}</td>
                        <td>{l.stages.done ?? '–'}</td>
                        <td>{l.mock && <Badge variant="mock">MOCK</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <form onSubmit={submitManual} className="flex items-center gap-2 border-t p-3">
            <Input
              ref={manualInput}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Ketik pertanyaan HR secara manual…"
              disabled={live.ended}
            />
            <Button type="submit" size="sm" disabled={!manual.trim() || live.ended}>
              <Send /> Jawab
            </Button>
            <div className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground xl:flex">
              <Kbd>Space</Kbd> jawab <Kbd>Esc</Kbd> abaikan <Kbd>R</Kbd> ulang <Kbd>/</Kbd> ketik <Kbd>P</Kbd> pause
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
