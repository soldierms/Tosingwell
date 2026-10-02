// THE internal data model. Every part of the app (sol-fa view, staff view,
// conversion, checks, playback, printing, export) reads from a `Score`.
// Sol-fa and staff notation are just two ways of drawing the same Score.
//
// Key design decisions:
// - Every note stores its real SOUNDING pitch (e.g. tenor middle C = C4),
//   never a syllable or a staff position. Syllables and accidentals are
//   calculated from the pitch + the key when a view is drawn.
// - Durations are exact fractions of a whole note (see fraction.ts).
// - Things that belong to the whole score at a bar (key, time, tempo,
//   repeats, endings, D.C./D.S., etc.) live in `MeasureInfo`.
//   Things that belong to one voice (notes, dynamics, lyrics) live in `Part`.

import type { Frac } from './fraction';

// ---------- Pitch ----------

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** A sounding pitch. octave uses scientific numbering: middle C = C4. */
export interface Pitch {
  step: Step;
  /** -2 double flat, -1 flat, 0 natural, 1 sharp, 2 double sharp */
  alter: number;
  octave: number;
}

/** A pitch name without octave, e.g. Eb (used for keys). */
export interface PitchClass {
  step: Step;
  alter: number;
}

// ---------- Key, time, clef, tempo ----------

export interface Key {
  /** The note that is "doh". In a minor key this is the relative major (lah-mode minor). */
  doh: PitchClass;
  mode: 'major' | 'minor';
}

export interface TimeSig {
  beats: number; // top number
  beatType: number; // bottom number
}

/** treble8vb = the "tenor" treble clef with a small 8 below: sounds an octave lower. */
export type Clef = 'treble' | 'bass' | 'treble8vb';

export interface Tempo {
  /** Beats per minute, if given (e.g. "q=90" → 90). */
  bpm?: number;
  /** The note value that gets the beat, as a fraction of a whole note (quarter = 1/4). */
  beatUnit?: Frac;
  /** Words such as "Allegro", if given. */
  text?: string;
}

// ---------- Marks that belong to a single note ----------

export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato';
export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'sf' | 'sfz' | 'fp';
export type Hairpin = 'cresc' | 'dim' | 'end';

export interface LyricSyllable {
  verse: number; // 1, 2, 3...
  text: string;
  /** Where the syllable sits in its word: whole word, start, middle, or end. */
  syllabic: 'single' | 'begin' | 'middle' | 'end';
  /** true = this syllable is held over the following note(s) (a melisma). */
  extend?: boolean;
}

/** A spot on the original image (used by the photo reader in Phase 4). */
export interface SourceRegion {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteEvent {
  /** Stable id, e.g. "S-m3-e2" (part S, bar 3, event 2). Used for highlighting and editing. */
  id: string;
  kind: 'note' | 'rest';
  /** Sounding pitches. Empty for rests. More than one = divisi / chord on one stem. */
  pitches: Pitch[];
  /** Real (sounding) length, as a fraction of a whole note. Triplet eighth = 1/12. */
  duration: Frac;
  /** Tuplet info, e.g. triplet = { actual: 3, normal: 2 } ("3 in the time of 2"). */
  tuplet?: { actual: number; normal: number; group: string };
  /** Grace notes take no time in the bar. */
  grace?: boolean;
  /** The pitches continue into the next note (a tie). */
  tieToNext?: boolean;
  slurStart?: boolean;
  slurEnd?: boolean;
  articulations?: Articulation[];
  fermata?: boolean;
  dynamic?: Dynamic;
  hairpin?: Hairpin;
  pedal?: 'down' | 'up';
  lyrics?: LyricSyllable[];
  /** Sol-fa bridge note at a key change: the syllable in the OLD key (e.g. "s" in "s/d"). */
  bridgeFrom?: string;
  /** 0..1. How sure the reader was. Typed input = 1. Photos may be lower. */
  confidence?: number;
  /** What the photo reader saw, if it came from an image. */
  source?: SourceRegion;
}

// ---------- Bar-level information shared by all parts ----------

export type Jump =
  | 'D.C.'
  | 'D.C. al Fine'
  | 'D.C. al Coda'
  | 'D.S.'
  | 'D.S. al Fine'
  | 'D.S. al Coda';

export type TempoChange = 'rit' | 'accel' | 'a tempo';

export interface MeasureInfo {
  /** 0-based position in the score. */
  index: number;
  /** The bar number printed on the page (pickup bar = 0). */
  number: number;
  /** Time signature in force for this bar (filled in for every bar). */
  time: TimeSig;
  /** Key at the START of this bar (filled in for every bar). */
  key: Key;
  /** True if the time signature changes at this bar. */
  timeChanged?: boolean;
  /** Key changes inside or at the start of this bar. offset = how far into the bar (0 = at the bar line). */
  keyChanges?: { offset: Frac; key: Key }[];
  tempo?: Tempo;
  tempoChanges?: { offset: Frac; kind: TempoChange }[];
  pickup?: boolean;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** First/second ending bracket over this bar. */
  ending?: { numbers: number[]; start: boolean; end: boolean };
  segno?: boolean;
  coda?: boolean; // the Coda section starts at this bar
  toCoda?: boolean; // "To Coda" sign at the end of this bar
  fine?: boolean; // "Fine" at the end of this bar
  jump?: Jump; // D.C./D.S. instruction at the end of this bar
  doubleBar?: boolean;
  finalBar?: boolean;
}

// ---------- Parts (voices) ----------

export type VoiceId = 'S' | 'A' | 'T' | 'B';

export interface PartMeasure {
  events: NoteEvent[];
}

export interface Part {
  id: VoiceId;
  name: string; // "Soprano"
  /** Which printed staff the part sits on in a closed (2-staff) score. */
  staff: 'upper' | 'lower';
  /** Stem direction when two parts share a staff. */
  stem: 'up' | 'down';
  measures: PartMeasure[];
}

// ---------- Warnings ("flags") ----------

export type FlagLevel = 'error' | 'warning' | 'info';

export interface Flag {
  level: FlagLevel;
  /** Short machine code, e.g. "bar-length", "range", "low-confidence". */
  code: string;
  message: string;
  part?: VoiceId;
  measure?: number; // 0-based index
  noteId?: string;
}

// ---------- The score ----------

export interface ScoreMeta {
  title: string;
  composer?: string;
  arranger?: string;
  /** Where the score came from, e.g. "typed sol-fa". */
  source?: string;
}

export interface DisplayOptions {
  /** Tenor on the bass staff (closed score), or on its own staff in octave-treble clef. */
  tenorClef: 'bass' | 'treble8vb';
}

export interface Score {
  meta: ScoreMeta;
  measures: MeasureInfo[];
  parts: Part[];
  /** Problems found while reading or checking. */
  flags: Flag[];
  /** If set, the octave of doh in sol-fa (e.g. 4 → doh is in the octave starting at middle C). */
  dohOctave?: number;
}

export const VOICE_NAMES: Record<VoiceId, string> = {
  S: 'Soprano',
  A: 'Alto',
  T: 'Tenor',
  B: 'Bass',
};

export const VOICE_ORDER: VoiceId[] = ['S', 'A', 'T', 'B'];
