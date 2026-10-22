import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, FlaskConical, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOB_DESCRIPTION_MIN_CHARS,
  MAX_AUTO_KEYTERMS,
  MAX_KEYTERM_CHARS,
  MAX_MANUAL_KEYTERMS,
  parseKeyterms,
  type AnswerFormat,
  type AnswerLength,
  type Language,
} from '@ic/shared';
import { api, type Cv, type Job } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/form-controls';
import { Alert, AlertDescription } from '@/components/ui/alert';

const NEW = '__new__';

/**
 * M0 POC setup: paste CV + job, pick session options, go live.
 * Replaced by the CV/Lowongan pages and the 3-step wizard in M1–M2.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const cvs = useQuery({ queryKey: ['cv'], queryFn: api.listCv });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: api.listJobs });

  const [cvId, setCvId] = useState(NEW);
  const [cvName, setCvName] = useState('CV utama');
  const [cvText, setCvText] = useState('');
  const [jobId, setJobId] = useState(NEW);
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<Language>('id');
  const [answerFormat, setFormat] = useState<AnswerFormat>('bullets');
  const [answerLength, setLength] = useState<AnswerLength>('short');
  const [keytermInput, setKeytermInput] = useState('');
  const keyterms = parseKeyterms(keytermInput);
  const keytermError =
    keyterms.length > MAX_MANUAL_KEYTERMS
      ? `Maksimal ${MAX_MANUAL_KEYTERMS} istilah tambahan (sekarang ${keyterms.length}).`
      : keyterms.find((t) => t.length > MAX_KEYTERM_CHARS)
        ? `Setiap istilah maksimal ${MAX_KEYTERM_CHARS} karakter.`
        : undefined;

  // Default to the active CV and the newest job once loaded.
  useEffect(() => {
    const active = cvs.data?.find((c) => c.isActive) ?? cvs.data?.[0];
    if (active) setCvId((v) => (v === NEW ? active.id : v));
  }, [cvs.data]);
  useEffect(() => {
    if (jobs.data?.[0]) setJobId((v) => (v === NEW ? jobs.data[0].id : v));
  }, [jobs.data]);

  const start = useMutation({
    mutationFn: async () => {
      const cv: Pick<Cv, 'id'> = cvId === NEW ? await api.createCv({ name: cvName, text: cvText }) : { id: cvId };
      const job: Pick<Job, 'id'> =
        jobId === NEW ? await api.createJob({ company, position, description }) : { id: jobId };
      return api.createSession({ cvId: cv.id, jobId: job.id, language, answerFormat, answerLength, keyterms });
    },
    onSuccess: (s) => navigate(`/session/${s.id}`),
    onError: (err) => toast.error((err as Error).message),
  });

  const descTooShort = jobId === NEW && description.trim().length < JOB_DESCRIPTION_MIN_CHARS;
  const canStart =
    (cvId !== NEW || cvText.trim().length >= 50) &&
    (jobId !== NEW || (company.trim() && position.trim() && !descTooShort)) &&
    !keytermError &&
    !start.isPending;

  return (
    <main className="container max-w-4xl space-y-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Interview Copilot</h1>
        <p className="text-sm text-muted-foreground">POC — tempel CV dan lowongan, lalu mulai sesi live.</p>
      </div>

      {health.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Server lokal tidak berjalan. Jalankan `npm run dev` lalu muat ulang.</AlertDescription>
        </Alert>
      )}
      {health.data?.liveLlm === 'mock' && (
        <Alert className="border-dashed border-fuchsia-500 bg-fuchsia-500/10">
          <FlaskConical className="text-fuchsia-600" />
          <AlertDescription>
            <strong>Mode mock aktif</strong> (<code>LIVE_LLM=mock</code>). Jawaban disimulasikan tanpa Claude dan
            latency-nya dilaporkan terpisah. Hapus atau ubah ke <code>claude</code> di <code>.env</code> untuk mode asli.
          </AlertDescription>
        </Alert>
      )}
      {health.data &&
        ((health.data.liveLlm !== 'mock' && !health.data.anthropicKey) || !health.data.deepgramKey) && (
        <Alert variant="warning">
          <AlertCircle />
          <AlertDescription>
            API key belum lengkap di <code>.env</code>:{' '}
            {[
              health.data.liveLlm !== 'mock' && !health.data.anthropicKey && 'ANTHROPIC_API_KEY',
              !health.data.deepgramKey && 'DEEPGRAM_API_KEY',
            ]
              .filter(Boolean)
              .join(', ')}
            . Isi lalu restart server.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>CV</CardTitle>
          <CardDescription>Teks ini adalah satu-satunya sumber pengalaman yang boleh dipakai AI.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <NativeSelect value={cvId} onChange={(e) => setCvId(e.target.value)}>
            {cvs.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.isActive ? '(aktif)' : ''}
              </option>
            ))}
            <option value={NEW}>+ Tempel CV baru</option>
          </NativeSelect>
          {cvId === NEW && (
            <>
              <Input value={cvName} onChange={(e) => setCvName(e.target.value)} placeholder="Nama CV" />
              <Textarea
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
                placeholder="Tempel isi CV di sini…"
                className="min-h-[220px] font-mono text-xs"
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lowongan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <NativeSelect value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.data?.map((j) => (
              <option key={j.id} value={j.id}>
                {j.position} — {j.company}
              </option>
            ))}
            <option value={NEW}>+ Lowongan baru</option>
          </NativeSelect>
          {jobId === NEW && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Perusahaan" />
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Posisi" />
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tempel deskripsi lowongan lengkap…"
                className="min-h-[180px] text-xs"
              />
              {description.length > 0 && descTooShort && (
                <p className="text-xs text-destructive">
                  Deskripsi terlalu pendek. Tempel deskripsi lowongan lengkap.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesi</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="lang">Bahasa</Label>
            <NativeSelect id="lang" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="id">Indonesia</option>
              <option value="en">English</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fmt">Format</Label>
            <NativeSelect id="fmt" value={answerFormat} onChange={(e) => setFormat(e.target.value as AnswerFormat)}>
              <option value="bullets">Poin</option>
              <option value="paragraph">Paragraf</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="len">Panjang</Label>
            <NativeSelect id="len" value={answerLength} onChange={(e) => setLength(e.target.value as AnswerLength)}>
              <option value="short">Pendek</option>
              <option value="medium">Sedang</option>
            </NativeSelect>
          </div>
          <div className="col-span-3 space-y-2">
            <Label htmlFor="keyterms">Istilah tambahan untuk transkrip (opsional)</Label>
            <Textarea
              id="keyterms"
              value={keytermInput}
              onChange={(e) => setKeytermInput(e.target.value)}
              placeholder="Mis. Smartani, Next.js, nama interviewer — pisahkan dengan koma atau baris baru"
              className="min-h-[60px] text-xs"
            />
            <p className={keytermError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {keytermError ??
                `Hingga ${MAX_AUTO_KEYTERMS} istilah teknis dan nama proyek diambil otomatis dari CV dan lowongan saat sesi dimulai. Tambahkan yang sering salah dengar di sini${keyterms.length ? ` (${keyterms.length} istilah)` : ''}.`}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={!canStart} onClick={() => start.mutate()}>
          {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
          Lanjut ke sesi
        </Button>
      </div>
    </main>
  );
}
