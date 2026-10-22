/**
 * Mock-mode stand-in for Claude's [SKIP] decision. Spoken transcripts often lack "?", so this
 * keys on question words. Deliberately generous: a false "question" just shows a mock card.
 */
const ID_WORDS = [
  'apa',
  'apakah',
  'bagaimana',
  'gimana',
  'mengapa',
  'kenapa',
  'kapan',
  'siapa',
  'berapa',
  'dimana',
  'ceritakan',
  'jelaskan',
  'coba',
  'boleh',
  'bisa',
];
const ID_PHRASES = ['di mana'];

const EN_WORDS = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'describe', 'explain'];
const EN_PHRASES = ['tell me', 'walk me', 'can you', 'could you', 'would you', 'do you', 'did you', 'have you', 'are you'];

const WORDS = new Set([...ID_WORDS, ...EN_WORDS]);
const PHRASES = [...ID_PHRASES, ...EN_PHRASES];

export function looksLikeQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes('?')) return true;
  const words = t.match(/[a-z]+/g) ?? [];
  // "-kah" suffix: bisakah, bolehkah, adakah… (length guard skips bare "kah").
  if (words.some((w) => WORDS.has(w) || (w.length > 4 && w.endsWith('kah')))) return true;
  const spaced = ` ${words.join(' ')} `;
  return PHRASES.some((p) => spaced.includes(` ${p} `));
}
