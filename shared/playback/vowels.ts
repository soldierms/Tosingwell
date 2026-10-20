// What the singing voice sings on each note: the vowel of the note's syllable (Fante/Twi and English),
// and how the syllable starts (a hum for m/n, a breath for s/h/f, a quick start for other consonants).
// A note without a syllable (melisma, or a part with no words) keeps the last vowel of that part, or
// sings "ah". Pure code, so it can be tested.

import type { ScheduledNote } from './schedule';

export type Vowel = 'a' | 'e' | 'ɛ' | 'i' | 'o' | 'ɔ' | 'u' | 'm';
export type Onset = 'none' | 'nasal' | 'breath' | 'voiced';
export interface SungSound {
  vowel: Vowel;
  onset: Onset;
}

const VOWEL_CHARS: Record<string, Vowel> = { a: 'a', e: 'e', ɛ: 'ɛ', ε: 'ɛ', ə: 'e', i: 'i', o: 'o', ɔ: 'ɔ', u: 'u' };
const NASAL = new Set(['m', 'n', 'ŋ']);
const BREATH = new Set(['s', 'h', 'f', 'x', 'ʃ', 'c', 'z', 'v', 'θ']);

/** The vowel and the kind of start of one written syllable, e.g. "Nya-" → a with a hum, "hyɛ" → ɛ with a breath. */
export function syllableSound(text: string): SungSound | undefined {
  const s = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-zɛεəɔŋʃθ]/g, '');
  if (!s) return undefined;
  let i = [...s].findIndex((c) => c in VOWEL_CHARS);
  let vowel: Vowel;
  if (i < 0) {
    const y = s.indexOf('y');
    if (y < 0) return { vowel: 'm', onset: 'none' }; // "N-" in N-hyi-ra: a hum
    i = y;
    vowel = 'i';
  } else {
    vowel = VOWEL_CHARS[s[i]];
    // English spellings: "ee" sounds i, "oo"/"ou" sound u
    const two = s.slice(i, i + 2);
    if (two === 'ee') vowel = 'i';
    else if (two === 'oo' || two === 'ou') vowel = 'u';
  }
  const first = s[0];
  const onset: Onset = i === 0 ? 'none' : NASAL.has(first) ? 'nasal' : BREATH.has(first) ? 'breath' : 'voiced';
  return { vowel, onset };
}

/** The sound for every sung note in the schedule (rests and tie continuations are left out). */
export function singingSounds(notes: ScheduledNote[]): Map<ScheduledNote, SungSound> {
  const out = new Map<ScheduledNote, SungSound>();
  const last = new Map<string, Vowel>();
  const sorted = notes.filter((n) => !n.rest && n.midi.length).sort((a, b) => a.start - b.start);
  for (const n of sorted) {
    const own = n.lyric !== undefined ? syllableSound(n.lyric) : undefined;
    const sound = own ?? { vowel: last.get(n.part) ?? 'a', onset: 'none' as const };
    last.set(n.part, sound.vowel);
    out.set(n, sound);
  }
  return out;
}
