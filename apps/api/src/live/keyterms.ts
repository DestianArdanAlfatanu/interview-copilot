/**
 * Deepgram keyterm prompting: pull technical terms and project names out of the CV + job text
 * so Nova-3 stops hearing "Next.js" as "NexJS". Pure heuristic (no LLM), runs at session start.
 *
 * Candidates, in order of confidence:
 *  - tech-shaped tokens: inner capitals (NestJS, PostgreSQL), acronyms (AWS, CI/CD), dotted
 *    names (Next.js, ASP.NET), letters+digits (S3, Nova-3), symbols (C++, C#)
 *  - runs of 1–3 capitalized words that don't open a prose sentence (Smartani, Diikat Janji)
 * Common capitalized words (pronouns, CV headings, job titles, months, …), emails and URLs
 * are dropped.
 */

import { MAX_AUTO_KEYTERMS, MAX_KEYTERM_CHARS } from '@ic/shared';

/** Deepgram caps keyterms at 500 tokens per request; ~1,500 chars stays well under it. */
const MAX_TOTAL_CHARS = 1_500;

const STOP = new Set([
  // pronouns, articles, connectors (ID + EN)
  'saya', 'aku', 'kami', 'kita', 'anda', 'kamu', 'dia', 'mereka', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk',
  'dengan', 'yang', 'pada', 'dalam', 'sebagai', 'serta', 'juga', 'ini', 'itu', 'para', 'the', 'a', 'an', 'and',
  'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'as', 'by', 'we', 'you', 'our', 'your', 'i', 'my', 'is',
  'are', 'be', 'will',
  // CV / job-post headings and filler
  'pengalaman', 'pendidikan', 'keahlian', 'kemampuan', 'kualifikasi', 'persyaratan', 'tanggung', 'jawab',
  'deskripsi', 'pekerjaan', 'profil', 'ringkasan', 'tentang', 'proyek', 'sertifikasi', 'organisasi', 'kontak',
  'lowongan', 'posisi', 'perusahaan', 'benefit', 'gaji', 'lokasi', 'experience', 'education', 'skills', 'skill',
  'summary', 'profile', 'about', 'projects', 'project', 'certifications', 'certification', 'requirements',
  'responsibilities', 'qualifications', 'job', 'description', 'position', 'company', 'location', 'contact',
  'present', 'sekarang', 'saat', 'tahun', 'bulan', 'years', 'year', 'months', 'remote', 'hybrid', 'onsite',
  'full', 'time', 'part', 'intern', 'magang', 'senior', 'junior', 'mid', 'level', 'lead',
  // job titles and generic CV words Deepgram already transcribes fine
  'developer', 'engineer', 'engineering', 'programmer', 'manager', 'staff', 'team', 'tim', 'student',
  'mahasiswa', 'universitas', 'university', 'institut', 'sekolah', 'gpa', 'ipk', 'freelance', 'front', 'end',
  'back', 'backend', 'frontend', 'fullstack', 'stack', 'web', 'mobile', 'software', 'aplikasi', 'sistem',
  'system', 'data', 'design', 'desain', 'teknologi', 'technology', 'informatika', 'indonesia',
  // months / days
  'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober',
  'november', 'desember', 'january', 'february', 'march', 'may', 'june', 'july', 'august', 'october',
  'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'agu', 'aug', 'sep', 'okt', 'oct', 'nov', 'des', 'dec',
  'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
  // generic tech-CV nouns
  'database', 'databases', 'tools', 'tool', 'framework', 'frameworks', 'library', 'libraries', 'languages',
  'founder', 'co-founder', 'vocational', 'school', 'bachelor', 'sarjana', 'diploma',
  // contact block and regions
  'address', 'alamat', 'phone', 'telepon', 'email', 'linkedin', 'portfolio', 'portofolio', 'website', 'area',
  'central', 'west', 'east', 'north', 'south', 'jawa', 'java', 'tengah', 'barat', 'timur', 'utara', 'selatan',
  // org prefixes that carry no sound worth boosting on their own
  'pt', 'cv', 'tbk', 'inc', 'ltd',
]);

const TOKEN_RE = /[A-Za-z0-9@][A-Za-z0-9.+#/@_-]*[A-Za-z0-9+#]|[A-Za-z]/g;

function isTechShaped(t: string): boolean {
  return (
    /[a-z][A-Z]/.test(t) || // NestJS, PostgreSQL, iOS
    /^[A-Z]{3,6}$/.test(t) || // AWS, SQL (2-letter acronyms are too noisy)
    /^[A-Z]{2,6}\/[A-Z]{2,6}$/.test(t) || // CI/CD, UI/UX
    /^[A-Za-z]+\.[A-Za-z]{2,}$/.test(t) || // Next.js, ASP.NET
    (/[A-Za-z]/.test(t) && /\d/.test(t) && t.length <= 12) || // S3, ES6, Nova-3
    /[+#]$/.test(t) // C++, C#
  );
}

const isCapitalized = (t: string) => /^[A-Z][a-z]{2,}$/.test(t);

/** "Development", "Authentication", "Testing": ordinary English nouns, not names. */
const isGenericNoun = (t: string) => /(tion|sion|ment|ing|ness|ity|ance|ence)$/.test(t);

/** Emails, URLs and paths are never spoken the way they're written. */
const isAddress = (t: string) => /@|\.(com|id|io|net|org|co|dev|app)\b|^https?|\/[a-z]/i.test(t);

interface Candidate {
  term: string;
  score: number;
  firstSeen: number;
}

export function extractKeyterms(texts: string[], max = MAX_AUTO_KEYTERMS): string[] {
  const found = new Map<string, Candidate>();
  let order = 0;
  const add = (term: string, weight: number) => {
    const key = term.toLowerCase();
    const c = found.get(key);
    if (c) c.score += weight;
    else found.set(key, { term, score: weight, firstSeen: order++ });
  };

  for (const text of texts) {
    // Lines, bullets and "|" separate CV fields; inside a line, ". " starts a new sentence.
    for (const line of text.split(/\n+|[•|]/)) {
      const words = (line.match(TOKEN_RE) ?? []).length;
      const prose = words >= 8;
      // A field that is only a name ("| Smartani |") is usually a company or project.
      const nameWeight = words > 0 && words <= 3 ? 3 : 2;
      for (const sentence of line.split(/(?<=[.!?:;])\s+/)) {
        scanSentence(sentence, prose, nameWeight, add);
      }
    }
  }

  return [...found.values()]
    .filter((c) => c.term.length <= MAX_KEYTERM_CHARS)
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .slice(0, max)
    .map((c) => c.term);
}

function scanSentence(
  sentence: string,
  prose: boolean,
  nameWeight: number,
  add: (term: string, weight: number) => void,
) {
  let run: string[] = [];
  const flush = () => {
    if (run.length) add(run.join(' '), nameWeight);
    run = [];
  };
  let prevEnd = 0;
  [...sentence.matchAll(TOKEN_RE)].forEach((m, i) => {
    const raw = m[0];
    // "Vite, Tailwind" are two names, not one: punctuation between tokens ends a run.
    if (/[^\s]/.test(sentence.slice(prevEnd, m.index))) flush();
    prevEnd = m.index! + raw.length;
    const t = raw.replace(/[.\-/]+$/, '');
    if (!t || isAddress(raw) || STOP.has(t.toLowerCase())) return flush();
    if (isTechShaped(t)) {
      flush();
      add(t, 3);
      return;
    }
    // Skip the first word of a prose sentence ("Kami mencari…"); short CV fields keep it.
    if (isCapitalized(t) && !isGenericNoun(t) && (i > 0 || !prose)) {
      run.push(t);
      if (run.length === 3) flush();
      return;
    }
    flush();
  });
  flush();
}

/** Manual terms first (the user knows best), then auto terms; de-duplicated and size-capped. */
export function mergeKeyterms(manual: string[], auto: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of [...manual, ...auto]) {
    const term = raw.trim().replace(/\s+/g, ' ');
    const key = term.toLowerCase();
    if (!term || term.length > MAX_KEYTERM_CHARS || seen.has(key)) continue;
    if (chars + term.length > MAX_TOTAL_CHARS) break;
    seen.add(key);
    out.push(term);
    chars += term.length;
  }
  return out;
}
