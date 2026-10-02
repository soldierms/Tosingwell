// The JSON shape Claude fills in when it reads a photo of a score.
// The API enforces this schema ("structured outputs"), so the answer always
// has exactly these fields. Our own code then turns it into a Score, using the
// same tested parsers and accidental rules as typed input — Claude reports
// what is PRINTED; the app works out what it MEANS.

export type Confidence = number; // 0 = could not read, 1 = certain

export interface ReadingPitch {
  /** Letter as printed on the staff. */
  step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  /** Octave as written on this clef (middle C = 4). For an octave-treble tenor clef, the WRITTEN octave. */
  octave: number;
  /** Accidental printed right next to this note, if any (key signature NOT included). */
  accidental: 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat' | null;
}

export interface ReadingEvent {
  kind: 'note' | 'rest';
  /** One pitch, or more for two notes on one stem (divisi). Empty for rests. */
  pitches: ReadingPitch[];
  length: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
  dots: number; // 0, 1 or 2
  /** This note is tied to the next one. */
  tie: boolean;
  grace: boolean;
  /** First / last note of a triplet or other tuplet group. */
  tupletStart: { actual: number; normal: number } | null;
  tupletEnd: boolean;
  articulations: ('staccato' | 'accent' | 'tenuto' | 'marcato')[];
  fermata: boolean;
  dynamic: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'sf' | 'sfz' | 'fp' | null;
  hairpin: 'cresc-start' | 'dim-start' | 'end' | null;
  slur: 'start' | 'end' | null;
  /** Lyric syllable under this note (verse 1). End with "-" if the word continues; "_" alone = held syllable. */
  lyric: string | null;
  confidence: Confidence;
}

export interface ReadingBar {
  /** Bar number counting from 1 (0 for a pickup bar). */
  number: number;
  /** For STAFF scores: the notes and rests, in order. */
  events: ReadingEvent[];
  /** For SOL-FA scores: this bar copied exactly in typed sol-fa (see the prompt), or null. */
  solfa: string | null;
  /** Lyrics under this bar for sol-fa scores (verse 1), words separated by spaces, or null. */
  solfaLyrics: string | null;
  repeatStart: boolean;
  repeatEnd: boolean;
  endBarline: 'single' | 'double' | 'final';
  /** Instructions at this bar, in the app's [..] words: "segno", "coda", "tocoda", "fine", "D.C. al Fine",
   *  "D.S. al Coda", "ending:1", "/ending", "rit", "accel", "a tempo", "key:D", "time:3/4", "tempo:Andante q=88". */
  directives: string[];
  /** True if (part of) this bar could not be read. Never fill gaps with guesses. */
  unreadable: boolean;
  /** Anything uncertain or odd about this bar, in plain words, or null. */
  problem: string | null;
  /** Where this bar is on the image, as fractions of width/height (0..1), or null. */
  region: { x: number; y: number; w: number; h: number } | null;
  confidence: Confidence;
}

export interface ReadingPart {
  voice: 'S' | 'A' | 'T' | 'B';
  clef: 'treble' | 'bass' | 'treble8vb' | 'none';
  bars: ReadingBar[];
}

export interface ScoreReading {
  notation: 'staff' | 'solfa' | 'not-music';
  title: string | null;
  composer: string | null;
  /** e.g. "G", "E minor", "Eb" (for sol-fa: the doh, from "Doh is G" / "Key G"). */
  key: string | null;
  time: string | null; // e.g. "3/4"
  tempo: string | null; // e.g. "Andante q=88"
  parts: ReadingPart[];
  /** Things the reader could not decide and wants the user to check, in plain words. */
  questions: string[];
  /** Overall photo quality problems (blur, glare, cut off, skew), in plain words. */
  photoProblems: string[];
}

// ---------- JSON Schema sent to the API ----------

const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties: Record<string, object>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const pitchSchema = obj({
  step: { type: 'string', enum: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] },
  octave: { type: 'integer' },
  accidental: nullable({ type: 'string', enum: ['sharp', 'flat', 'natural', 'double-sharp', 'double-flat'] }),
});

const eventSchema = obj({
  kind: { type: 'string', enum: ['note', 'rest'] },
  pitches: { type: 'array', items: pitchSchema },
  length: { type: 'string', enum: ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] },
  dots: { type: 'integer' },
  tie: { type: 'boolean' },
  grace: { type: 'boolean' },
  tupletStart: nullable(obj({ actual: { type: 'integer' }, normal: { type: 'integer' } })),
  tupletEnd: { type: 'boolean' },
  articulations: { type: 'array', items: { type: 'string', enum: ['staccato', 'accent', 'tenuto', 'marcato'] } },
  fermata: { type: 'boolean' },
  dynamic: nullable({ type: 'string', enum: ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sf', 'sfz', 'fp'] }),
  hairpin: nullable({ type: 'string', enum: ['cresc-start', 'dim-start', 'end'] }),
  slur: nullable({ type: 'string', enum: ['start', 'end'] }),
  lyric: nullable({ type: 'string' }),
  confidence: { type: 'number' },
});

const barSchema = obj({
  number: { type: 'integer' },
  events: { type: 'array', items: eventSchema },
  solfa: nullable({ type: 'string' }),
  solfaLyrics: nullable({ type: 'string' }),
  repeatStart: { type: 'boolean' },
  repeatEnd: { type: 'boolean' },
  endBarline: { type: 'string', enum: ['single', 'double', 'final'] },
  directives: { type: 'array', items: { type: 'string' } },
  unreadable: { type: 'boolean' },
  problem: nullable({ type: 'string' }),
  region: nullable(obj({ x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } })),
  confidence: { type: 'number' },
});

export const SCORE_READING_SCHEMA = obj({
  notation: { type: 'string', enum: ['staff', 'solfa', 'not-music'] },
  title: nullable({ type: 'string' }),
  composer: nullable({ type: 'string' }),
  key: nullable({ type: 'string' }),
  time: nullable({ type: 'string' }),
  tempo: nullable({ type: 'string' }),
  parts: {
    type: 'array',
    items: obj({
      voice: { type: 'string', enum: ['S', 'A', 'T', 'B'] },
      clef: { type: 'string', enum: ['treble', 'bass', 'treble8vb', 'none'] },
      bars: { type: 'array', items: barSchema },
    }),
  },
  questions: { type: 'array', items: { type: 'string' } },
  photoProblems: { type: 'array', items: { type: 'string' } },
});
