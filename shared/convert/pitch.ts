// Pitch maths: note names, key signatures, and movable-doh sol-fa syllables.
// This file is the heart of converting between Sol-fa and Staff notation.

import type { Key, Pitch, PitchClass, Step, VoiceId } from '../model/types';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONE: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Position of each natural note on the circle of fifths (C = 0). */
const STEP_FIFTHS: Record<Step, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

export const stepIndex = (s: Step) => STEPS.indexOf(s);

/** MIDI note number (middle C = 60). */
export function midi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONE[p.step] + p.alter;
}

export function pitchClassSemitone(pc: PitchClass): number {
  return (((STEP_SEMITONE[pc.step] + pc.alter) % 12) + 12) % 12;
}

// ---------- Names ----------

const ALTER_TEXT: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };
const ALTER_PRETTY: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

export const pitchClassName = (pc: PitchClass, pretty = false) =>
  pc.step + (pretty ? ALTER_PRETTY[pc.alter] : ALTER_TEXT[pc.alter]);

export const pitchName = (p: Pitch) => pitchClassName(p) + p.octave;

/** Parse "G", "Bb", "F#", "Eb" (also accepts ♭ ♯). Returns undefined if not a note name. */
export function parsePitchClass(text: string): PitchClass | undefined {
  const m = /^([A-Ga-g])(##|#|♯|bb|b|♭|𝄫|𝄪)?$/.exec(text.trim());
  if (!m) return undefined;
  const acc = m[2] ?? '';
  const alter = { '': 0, '#': 1, '♯': 1, '##': 2, '𝄪': 2, b: -1, '♭': -1, bb: -2, '𝄫': -2 }[acc] ?? 0;
  return { step: m[1].toUpperCase() as Step, alter };
}

/** Parse "C4", "F#3", "Bb2". */
export function parsePitch(text: string): Pitch | undefined {
  const m = /^([A-Ga-g](?:##|#|bb|b)?)(-?\d)$/.exec(text.trim());
  if (!m) return undefined;
  const pc = parsePitchClass(m[1]);
  return pc && { ...pc, octave: Number(m[2]) };
}

// ---------- Keys ----------

/** Sharps (+) or flats (-) in the key signature of a major key with this doh. */
export function keyFifths(key: Key): number {
  return STEP_FIFTHS[key.doh.step] + 7 * key.doh.alter;
}

/** The sharp/flat the key signature puts on this letter (0 if none). */
export function keyAlter(step: Step, key: Key): number {
  const f = keyFifths(key);
  // How many times this letter appears in the first |f| sharps/flats (2 = double sharp/flat).
  const count = (order: Step[], n: number) => Math.max(0, Math.floor((n - 1 - order.indexOf(step)) / 7) + 1);
  if (f > 0) return count(SHARP_ORDER, f);
  if (f < 0) return -count(FLAT_ORDER, -f) || 0; // "|| 0" avoids -0
  return 0;
}

/** The minor key's tonic is lah (a minor third below doh). */
export function lahOf(doh: PitchClass): PitchClass {
  const step = STEPS[(stepIndex(doh.step) + 5) % 7];
  const want = (pitchClassSemitone(doh) + 9) % 12;
  return { step, alter: alterFor(step, want) };
}

/** doh of the relative major for a minor tonic (A minor → C). */
export function dohOfMinor(tonic: PitchClass): PitchClass {
  const step = STEPS[(stepIndex(tonic.step) + 2) % 7];
  const want = (pitchClassSemitone(tonic) + 3) % 12;
  return { step, alter: alterFor(step, want) };
}

function alterFor(step: Step, semitone: number): number {
  let a = semitone - STEP_SEMITONE[step];
  if (a > 6) a -= 12;
  if (a < -6) a += 12;
  return a;
}

/**
 * Parse a key as written by a user: "G", "Eb", "F# major", "A minor", "Am",
 * "doh = G", "Doh is Eb".
 */
export function parseKey(text: string): Key | undefined {
  let t = text.trim().replace(/^(doh|do|d)\s*(=|is)\s*/i, '');
  let mode: Key['mode'] = 'major';
  const minor = /^(.+?)\s*(minor|min|m)$/i.exec(t);
  const major = /^(.+?)\s*(major|maj)$/i.exec(t);
  if (minor && !/^[A-G]b?$/.test(t)) {
    mode = 'minor';
    t = minor[1];
  } else if (major) t = major[1];
  const pc = parsePitchClass(t);
  if (!pc) return undefined;
  return { doh: mode === 'minor' ? dohOfMinor(pc) : pc, mode };
}

/** "G major (Doh = G)" or "E minor (Doh = G, Lah = E)". */
export function keyLabel(key: Key): string {
  const doh = pitchClassName(key.doh, true);
  if (key.mode === 'minor') {
    const lah = pitchClassName(lahOf(key.doh), true);
    return `${lah} minor (Doh = ${doh}, Lah = ${lah})`;
  }
  return `${doh} major (Doh = ${doh})`;
}

/** Key name as VexFlow wants it, e.g. "Bb", "F#", "Am" is drawn the same as "C". */
export const vexKeyName = (key: Key) => pitchClassName(key.doh);

export const sameKey = (a: Key, b: Key) =>
  a.mode === b.mode && a.doh.step === b.doh.step && a.doh.alter === b.doh.alter;

// ---------- Sol-fa ----------

/**
 * Sol-fa syllables, by scale degree (0 = doh) and chromatic change
 * (+1 = raised, -1 = lowered). These are the names the app WRITES.
 */
const SYLLABLE_TABLE: Record<number, Record<number, string>> = {
  0: { 0: 'd', 1: 'de' },
  1: { [-1]: 'ra', 0: 'r', 1: 'ri' },
  2: { [-1]: 'me', 0: 'm' },
  3: { 0: 'f', 1: 'fe' },
  4: { 0: 's', 1: 'se' },
  5: { [-1]: 'le', 0: 'l', 1: 'li' },
  6: { [-1]: 'ta', 0: 't' },
};

/** Every syllable the app READS → [degree, chromatic change]. Includes alternate spellings. */
export const SYLLABLES: Record<string, [number, number]> = {
  d: [0, 0], de: [0, 1], di: [0, 1],
  ra: [1, -1], r: [1, 0], ri: [1, 1],
  me: [2, -1], ma: [2, -1], m: [2, 0],
  f: [3, 0], fe: [3, 1], fi: [3, 1],
  s: [4, 0], se: [4, 1], si: [4, 1],
  le: [5, -1], la: [5, -1], l: [5, 0], li: [5, 1],
  ta: [6, -1], te: [6, -1], t: [6, 0],
};

/**
 * Bass sol-fa is written an octave higher than it sounds; the tenor is written
 * at its real pitch (confirmed by the owner on a real score, 2026-10-05: on the
 * opening chord the tenor's plain d sounds an octave ABOVE the bass's plain d).
 */
export const SOLFA_OCTAVE_SHIFT: Record<VoiceId, number> = { S: 0, A: 0, T: 0, B: -1 };

/**
 * Which octave "unmarked" doh is in. Rule used: doh is in octave 4 (middle C
 * up to G above it) for keys C–G, and octave 3 for keys A and B (so doh is
 * never higher than G#4). Checked with the owner on a real B♭ score
 * (2026-10-05): the soprano's plain "s" is the F just above middle C, so
 * plain d is the B♭ BELOW middle C. Can be overridden per score with "Doh: Bb4".
 */
export function defaultDohOctave(key: Key): number {
  return ['A', 'B'].includes(key.doh.step) ? 3 : 4;
}

export interface SolfaNote {
  syllable: string;
  /** +1 = one apostrophe (higher octave), -1 = one comma (lower octave). */
  octave: number;
  /** True if the exact spelling could not be written in sol-fa and an equivalent was used. */
  respelled?: boolean;
}

export function solfaToPitch(
  syllable: string,
  octaveMarks: number,
  key: Key,
  dohOctave: number,
  voice: VoiceId,
): Pitch | undefined {
  const entry = SYLLABLES[syllable];
  if (!entry) return undefined;
  const [degree, chroma] = entry;
  const dohIdx = stepIndex(key.doh.step);
  const idx = dohIdx + degree;
  const step = STEPS[idx % 7];
  const octave = dohOctave + Math.floor(idx / 7) + octaveMarks + SOLFA_OCTAVE_SHIFT[voice];
  return { step, alter: keyAlter(step, key) + chroma, octave };
}

export function pitchToSolfa(p: Pitch, key: Key, dohOctave: number, voice: VoiceId): SolfaNote {
  const dohIdx = stepIndex(key.doh.step);
  const pIdx = stepIndex(p.step);
  const degree = (pIdx - dohIdx + 7) % 7;
  const baseOctave = dohOctave + Math.floor((dohIdx + degree) / 7) + SOLFA_OCTAVE_SHIFT[voice];
  const chroma = p.alter - keyAlter(p.step, key);
  const name = SYLLABLE_TABLE[degree][chroma];
  if (name !== undefined) return { syllable: name, octave: p.octave - baseOctave };

  // Spelling has no sol-fa name (e.g. E# in C). Use a syllable with the same sound.
  const target = midi(p);
  for (let dd = -1; dd <= 1; dd += 2) {
    const deg2 = (degree + dd + 7) % 7;
    for (const syl of Object.values(SYLLABLE_TABLE[deg2])) {
      const cand = solfaToPitch(syl, 0, key, dohOctave, voice)!;
      const diff = target - midi(cand);
      if (diff % 12 === 0) return { syllable: syl, octave: diff / 12, respelled: true };
    }
  }
  return { syllable: SYLLABLE_TABLE[degree][0], octave: p.octave - baseOctave, respelled: true };
}

/** Sol-fa octave marks as text: 1 → "'", -2 → ",,". */
export const octaveMarks = (n: number) => (n > 0 ? "'".repeat(n) : ','.repeat(-n));

// ---------- Voice ranges ----------

/** Normal singing range for each voice, as MIDI numbers (sounding). */
export const VOICE_RANGES: Record<VoiceId, { low: number; high: number; text: string }> = {
  S: { low: 60, high: 81, text: 'C4–A5' },
  A: { low: 53, high: 74, text: 'F3–D5' },
  T: { low: 48, high: 69, text: 'C3–A4' },
  B: { low: 40, high: 64, text: 'E2–E4' },
};
