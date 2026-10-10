// MusicXML → ScoreReading, so a page read by Audiveris (a dedicated music-reading program) goes
// through exactly the same path as an AI reading: readingToText → typed staff text → normal parser,
// checks and review screen.
//
// Choir layouts handled:
//   • closed score: one part with 2 staves (S+A on the upper staff, T+B on the lower), two voices each;
//   • open score: one staff per voice (S, A, T, B in order); a piano part (a 2-staff part below
//     single-staff voice parts, or a part named Piano/Organ) is left out;
//   • a single melody staff → Soprano.
// Accidentals are written out wherever the typed text needs them, per voice, so the parser's
// key-signature/bar rules give back exactly the pitch Audiveris read.

import type { ReadingBar, ReadingEvent, ReadingPart, ReadingPitch, ScoreReading } from '../vision/schema';
import { find, kid, kids, parseXml, txt, type XmlEl } from './xml';

type Step = ReadingPitch['step'];
type Voice = 'S' | 'A' | 'T' | 'B';
type Clef = ReadingPart['clef'];

interface RawNote {
  voice: string;
  staff: number;
  chord: boolean;
  grace: boolean;
  rest: boolean;
  pitch?: { step: Step; alter: number; octave: number };
  divs: number; // duration in divisions (0 for grace)
  type?: string;
  dots: number;
  tie: boolean;
  tupletStart?: { actual: number; normal: number };
  tupletEnd: boolean;
  articulations: ReadingEvent['articulations'];
  fermata: boolean;
  slur: ReadingEvent['slur'];
  lyric: string | null;
  dynamic: ReadingEvent['dynamic'];
  hairpin: ReadingEvent['hairpin'];
  stem?: 'up' | 'down';
  /** Start of this note in the bar, in quarter notes. */
  at?: number;
}

interface RawMeasure {
  implicit: boolean;
  /** First bar of a new line of music (system). */
  newSystem: boolean;
  /** Clef in force on staff 1 in this bar. */
  clef?: Clef;
  lenDivs: number;
  fifths: number;
  repeatStart: boolean;
  repeatEnd: boolean;
  endBarline: ReadingBar['endBarline'];
  directives: string[];
  /** staff number → voice id → notes in order */
  staves: Map<number, Map<string, RawNote[]>>;
  /** Plain text under a staff (Audiveris often files lyrics this way), with its place in the bar. */
  words: { staff: number; offset: number; text: string }[];
}

interface RawPart {
  hasTime: boolean;
  name: string;
  staffCount: number;
  clefs: Map<number, Clef>;
  measures: RawMeasure[];
}

const LENGTHS: { type: ReadingEvent['length']; q: number }[] = [
  { type: 'whole', q: 4 },
  { type: 'half', q: 2 },
  { type: 'quarter', q: 1 },
  { type: 'eighth', q: 0.5 },
  { type: '16th', q: 0.25 },
  { type: '32nd', q: 0.125 },
];
const TYPE_OK = new Set(LENGTHS.map((l) => l.type));
const MAJOR: Record<number, string> = { [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const MINOR: Record<number, string> = { [-7]: 'Ab', [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#' };
const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const DYN = new Set(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sf', 'sfz', 'fp']);
const TEMPO_WORDS = /^(largo|lento|adagio|andante|andantino|moderato|allegretto|allegro|vivace|presto|maestoso|grave)\b/i;

const keyAlter = (fifths: number, step: Step) =>
  fifths > 0 ? (SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0) : fifths < 0 ? ([...SHARP_ORDER].reverse().slice(0, -fifths).includes(step) ? -1 : 0) : 0;
const pitchValue = (p: RawNote['pitch']) => (p ? p.octave * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p.step] + p.alter : 0);

function wordsDirective(w: string): string[] {
  const s = w.trim();
  const l = s.toLowerCase().replace(/\s+/g, ' ');
  if (!s) return [];
  if (/^fine\.?$/.test(l)) return ['fine'];
  if (/d\.? ?c\.? al fine/.test(l)) return ['D.C. al Fine'];
  if (/d\.? ?c\.? al coda/.test(l)) return ['D.C. al Coda'];
  if (/d\.? ?s\.? al fine/.test(l)) return ['D.S. al Fine'];
  if (/d\.? ?s\.? al coda/.test(l)) return ['D.S. al Coda'];
  if (/^d\.? ?c\.?$|^da capo$/.test(l)) return ['D.C.'];
  if (/^d\.? ?s\.?$|^dal segno$/.test(l)) return ['D.S.'];
  if (/to coda/.test(l)) return ['tocoda'];
  if (/^a tempo/.test(l)) return ['a tempo'];
  if (/^(rit|rall)/.test(l)) return ['rit'];
  if (/^accel/.test(l)) return ['accel'];
  if (TEMPO_WORDS.test(s)) return [`tempo:${s.replace(/[[\]{}|]/g, '')}`];
  return [];
}

function readPart(partEl: XmlEl, name: string): RawPart {
  let divisions = 1;
  let fifths = 0;
  let beats = 4;
  let beatType = 4;
  let staffCount = 1;
  let hasTime = false;
  const clefs = new Map<number, Clef>();
  const current = new Map<number, Clef>();
  const measures: RawMeasure[] = [];
  const pendingDyn = new Map<number, ReadingEvent['dynamic']>();
  const pendingHair = new Map<number, ReadingEvent['hairpin']>();

  for (const mEl of kids(partEl, 'measure')) {
    const m: RawMeasure = {
      implicit: mEl.attrs.implicit === 'yes',
      newSystem: kids(mEl, 'print').some((p) => p.attrs['new-system'] === 'yes' || p.attrs['new-page'] === 'yes'),
      lenDivs: 0,
      fifths,
      repeatStart: false,
      repeatEnd: false,
      endBarline: 'single',
      directives: [],
      staves: new Map(),
      words: [],
    };
    let cursor = 0; // position in the bar, in quarter notes
    for (const el of mEl.children) {
      if (el.name === 'attributes') {
        const d = Number(txt(el, 'divisions'));
        if (d > 0) divisions = d;
        const key = kid(el, 'key');
        if (key && txt(key, 'fifths') !== undefined) {
          const f = Number(txt(key, 'fifths'));
          if (measures.length && f !== fifths) m.directives.push(`key:${(txt(key, 'mode') === 'minor' ? MINOR[f] + ' minor' : MAJOR[f])}`);
          fifths = f;
          m.fifths = f;
        }
        const time = kid(el, 'time');
        if (time && txt(time, 'beats')) {
          const b = Number(txt(time, 'beats'));
          const bt = Number(txt(time, 'beat-type'));
          if (measures.length && (b !== beats || bt !== beatType)) m.directives.push(`time:${b}/${bt}`);
          beats = b;
          beatType = bt;
          hasTime = true;
        }
        const st = Number(txt(el, 'staves'));
        if (st > 0) staffCount = st;
        for (const c of kids(el, 'clef')) {
          const n = Number(c.attrs.number ?? 1);
          const sign = txt(c, 'sign');
          const oct = Number(txt(c, 'clef-octave-change') ?? 0);
          const clef: Clef = sign === 'F' ? 'bass' : sign === 'G' ? (oct === -1 ? 'treble8vb' : 'treble') : 'none';
          if (!clefs.has(n)) clefs.set(n, clef);
          current.set(n, clef);
        }
      } else if (el.name === 'barline') {
        const loc = el.attrs.location ?? 'right';
        const rep = kid(el, 'repeat');
        if (rep?.attrs.direction === 'forward') m.repeatStart = true;
        if (rep?.attrs.direction === 'backward') m.repeatEnd = true;
        const style = txt(el, 'bar-style');
        if (loc === 'right' && style === 'light-light') m.endBarline = 'double';
        if (loc === 'right' && style === 'light-heavy') m.endBarline = 'final';
        const end = kid(el, 'ending');
        if (end && end.attrs.type === 'start') m.directives.push(`ending:${(end.attrs.number ?? '1').replace(/\s+/g, '')}`);
        if (find(el, 'segno')) m.directives.push('segno');
        if (find(el, 'coda')) m.directives.push('coda');
      } else if (el.name === 'direction') {
        const staff = Number(txt(el, 'staff') ?? 1);
        for (const dt of kids(el, 'direction-type')) {
          for (const w of kids(dt, 'words')) {
            const ds = wordsDirective(w.text);
            for (const d of ds) if (!m.directives.includes(d)) m.directives.push(d);
            const below = el.attrs.placement === 'below' || Number(w.attrs['default-y'] ?? 0) < 0;
            if (!ds.length && below && w.text.trim()) m.words.push({ staff, offset: cursor, text: w.text.trim() });
          }
          if (kid(dt, 'segno')) m.directives.push('segno');
          if (kid(dt, 'coda')) m.directives.push('coda');
          const dyn = kid(dt, 'dynamics');
          const dname = dyn?.children[0]?.name;
          if (dname && DYN.has(dname)) pendingDyn.set(staff, dname as ReadingEvent['dynamic']);
          const wedge = kid(dt, 'wedge');
          if (wedge) {
            const t = wedge.attrs.type;
            pendingHair.set(staff, t === 'crescendo' ? 'cresc-start' : t === 'diminuendo' ? 'dim-start' : 'end');
          }
          const met = kid(dt, 'metronome');
          if (met && txt(met, 'per-minute') && txt(met, 'beat-unit') === 'quarter') {
            const ex = m.directives.findIndex((d) => d.startsWith('tempo:'));
            const q = `q=${Number(txt(met, 'per-minute'))}`;
            if (ex >= 0) m.directives[ex] += ` ${q}`;
            else m.directives.push(`tempo:${q}`);
          }
        }
      } else if (el.name === 'backup') {
        cursor -= Number(txt(el, 'duration') ?? 0) / divisions;
      } else if (el.name === 'note' || el.name === 'forward') {
        const isForward = el.name === 'forward';
        const staff = Number(txt(el, 'staff') ?? 1);
        const voice = txt(el, 'voice') ?? '1';
        const notations = kid(el, 'notations');
        const pitchEl = kid(el, 'pitch');
        const lyricEl = kids(el, 'lyric').find((l) => (l.attrs.number ?? '1') === '1') ?? kid(el, 'lyric');
        let lyric: string | null = null;
        if (lyricEl) {
          const t = txt(lyricEl, 'text');
          const syl = txt(lyricEl, 'syllabic');
          if (t) lyric = t + (syl === 'begin' || syl === 'middle' ? '-' : '');
          else if (kid(lyricEl, 'extend')) lyric = '_';
        }
        const tm = kid(el, 'time-modification');
        const tup = kids(notations, 'tuplet');
        const art = kid(notations, 'articulations');
        const slurs = kids(notations, 'slur');
        const isRest = isForward || !!kid(el, 'rest');
        const n: RawNote = {
          voice,
          staff,
          chord: !!kid(el, 'chord'),
          grace: !!kid(el, 'grace'),
          rest: isRest,
          pitch: pitchEl
            ? { step: txt(pitchEl, 'step') as Step, alter: Math.round(Number(txt(pitchEl, 'alter') ?? 0)), octave: Number(txt(pitchEl, 'octave')) }
            : undefined,
          divs: Number(txt(el, 'duration') ?? 0) / divisions,
          type: txt(el, 'type'),
          dots: kids(el, 'dot').length,
          tie: kids(el, 'tie').some((t) => t.attrs.type === 'start') || kids(notations, 'tied').some((t) => t.attrs.type === 'start'),
          tupletStart: tup.some((t) => t.attrs.type === 'start') && tm
            ? { actual: Number(txt(tm, 'actual-notes') ?? 3), normal: Number(txt(tm, 'normal-notes') ?? 2) }
            : undefined,
          tupletEnd: tup.some((t) => t.attrs.type === 'stop'),
          articulations: [
            ...(kid(art, 'staccato') ? (['staccato'] as const) : []),
            ...(kid(art, 'accent') ? (['accent'] as const) : []),
            ...(kid(art, 'tenuto') ? (['tenuto'] as const) : []),
            ...(kid(art, 'strong-accent') ? (['marcato'] as const) : []),
          ],
          fermata: !!kid(notations, 'fermata'),
          slur: slurs.some((s) => s.attrs.type === 'start') ? 'start' : slurs.some((s) => s.attrs.type === 'stop') ? 'end' : null,
          lyric,
          dynamic: null,
          hairpin: null,
          stem: txt(el, 'stem') === 'up' ? 'up' : txt(el, 'stem') === 'down' ? 'down' : undefined,
        };
        if (!n.rest && !n.chord && !n.grace) {
          n.dynamic = pendingDyn.get(staff) ?? null;
          n.hairpin = pendingHair.get(staff) ?? null;
          pendingDyn.delete(staff);
          pendingHair.delete(staff);
        }
        if (!n.chord && !n.grace) cursor += n.divs;
        (n as RawNote & { at?: number }).at = cursor - (n.chord || n.grace ? 0 : n.divs);
        if (!isForward || kid(el, 'voice')) {
          const sv = m.staves.get(staff) ?? new Map<string, RawNote[]>();
          m.staves.set(staff, sv);
          const list = sv.get(voice) ?? [];
          sv.set(voice, list);
          list.push(n);
        }
      }
    }
    m.lenDivs = beats * (4 / beatType);
    m.clef = current.get(1);
    measures.push(m);
  }
  return { name, staffCount, clefs, measures, hasTime };
}

/** Lengths (with dots) that add up to `q` quarter notes, for rests or notes without a printed type. */
function splitLength(q: number): { type: ReadingEvent['length']; dots: number }[] {
  const out: { type: ReadingEvent['length']; dots: number }[] = [];
  let left = q;
  while (left > 1e-6) {
    let picked = false;
    for (const l of LENGTHS) {
      for (const dots of [2, 1, 0]) {
        const v = l.q * (2 - 1 / 2 ** dots);
        if (v <= left + 1e-6) {
          out.push({ type: l.type, dots });
          left -= v;
          picked = true;
          break;
        }
      }
      if (picked) break;
    }
    if (!picked) break;
  }
  return out;
}

const voiceLength = (notes: RawNote[]) => notes.filter((n) => !n.chord && !n.grace).reduce((s, n) => s + n.divs, 0);
const noteLength = (notes: RawNote[]) => notes.filter((n) => !n.chord && !n.grace && !n.rest).reduce((s, n) => s + n.divs, 0);

/** Group a voice's raw notes into events: chord notes join the note before them. */
function groupChords(notes: RawNote[]): RawNote[][] {
  const out: RawNote[][] = [];
  for (const n of notes) {
    if (n.chord && out.length) out[out.length - 1].push(n);
    else out.push([n]);
  }
  return out;
}

type Pick = { events: RawNote[][]; problem?: string };

/** The notes of one staff in one bar for a whole staff (one voice), or its upper/lower voice. */
function pickVoice(sv: Map<string, RawNote[]> | undefined, len: number, which: 'all' | 'upper' | 'lower'): Pick {
  if (!sv || !sv.size) return { events: [] };
  const voices = [...sv.entries()].map(([id, notes]) => ({ id, notes, sung: noteLength(notes), len: voiceLength(notes) }));
  const avg = (notes: RawNote[]) => {
    const ps = notes.filter((n) => n.pitch).map((n) => pitchValue(n.pitch));
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
  };
  // Prefer voices that fill the bar; among them, the ones with the most sung notes.
  const ranked = [...voices].sort((a, b) => Number(Math.abs(b.len - len) < 1e-6) - Number(Math.abs(a.len - len) < 1e-6) || b.sung - a.sung);
  const extra = ranked.length > (which === 'all' ? 1 : 2) && ranked.slice(which === 'all' ? 1 : 2).some((v) => v.sung > 0);
  const problem = extra ? 'more voices were found on this staff than expected; the extra notes were left out — please compare with the page' : undefined;
  if (which === 'all') return { events: groupChords(ranked[0].notes), problem };
  if (ranked.length >= 2 && ranked[1].sung > 0) {
    const [a, b] = ranked.slice(0, 2).sort((x, y) => avg(y.notes) - avg(x.notes));
    return { events: groupChords((which === 'upper' ? a : b).notes), problem };
  }
  // One voice only. Two notes on one stem are split (top → upper voice). A single note belongs to
  // the upper voice if its stem points up, to the lower if down (the other voice rests then).
  const events = groupChords(ranked[0].notes).map((ev): RawNote[] => {
    const notes = ev.filter((n) => !n.rest);
    if (notes.length >= 2) {
      const sorted = [...notes].sort((x, y) => pitchValue(y.pitch) - pitchValue(x.pitch));
      const keep = which === 'upper' ? sorted[0] : sorted[sorted.length - 1];
      return [{ ...keep, chord: false }];
    }
    const stem = notes[0]?.stem;
    if (stem && (stem === 'up') !== (which === 'upper')) {
      return [{ ...ev[0], rest: true, pitch: undefined, tie: false, lyric: null, chord: false, dynamic: null, hairpin: null, slur: null }];
    }
    return ev;
  });
  return { events, problem };
}

/** Raw events → reading events, writing out accidentals the typed text needs (per voice, per bar). */
function toEvents(evs: RawNote[][], fifths: number, octaveShift: number): ReadingEvent[] {
  const state = new Map<string, number>();
  const out: ReadingEvent[] = [];
  for (const ev of evs) {
    const first = ev[0];
    const pitches: ReadingPitch[] = [];
    if (!first.rest) {
      for (const n of ev) {
        if (!n.pitch) continue;
        const key = `${n.pitch.step}${n.pitch.octave}`;
        const expected = state.get(key) ?? keyAlter(fifths, n.pitch.step);
        let accidental: ReadingPitch['accidental'] = null;
        if (n.pitch.alter !== expected) {
          accidental = ({ [-2]: 'double-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' } as const)[n.pitch.alter as -2 | -1 | 0 | 1 | 2] ?? null;
          state.set(key, n.pitch.alter);
        }
        pitches.push({ step: n.pitch.step, octave: n.pitch.octave + octaveShift, accidental });
      }
    }
    const typed = first.type && TYPE_OK.has(first.type as ReadingEvent['length'])
      ? { type: first.type as ReadingEvent['length'], dots: first.dots }
      : undefined;
    const typedQ = typed ? LENGTHS.find((l) => l.type === typed.type)!.q * (2 - 1 / 2 ** typed.dots) : 0;
    // Whole-bar rests are printed as a whole rest in any time signature: use their real length.
    const lengths = typed && !(first.rest && !first.tupletStart && Math.abs(typedQ - first.divs) > 1e-6) ? [typed] : splitLength(first.divs);
    lengths.forEach((l, i) => {
      const last = i === lengths.length - 1;
      out.push({
        kind: pitches.length ? 'note' : 'rest',
        pitches,
        length: l.type,
        dots: l.dots,
        tie: pitches.length > 0 && (last ? ev.some((n) => n.tie) : true),
        grace: first.grace,
        tupletStart: i === 0 ? first.tupletStart ?? null : null,
        tupletEnd: last && first.tupletEnd,
        articulations: i === 0 ? first.articulations : [],
        fermata: last && first.fermata,
        dynamic: i === 0 ? first.dynamic : null,
        hairpin: i === 0 ? first.hairpin : null,
        slur: i === 0 ? first.slur : null,
        lyric: i === 0 && pitches.length ? first.lyric : null,
        confidence: 1,
      });
    });
  }
  return out;
}

/**
 * Audiveris often reads the words under a staff as plain text ("give him your") instead of lyrics.
 * If a voice has no lyrics, put those words on its notes, one syllable per sung note, starting at the
 * first note at or after where the text sits in the bar.
 */
function placeWords(part: RawPart, staff: number, bars: RawNote[][][]): void {
  if (bars.some((b) => b.some((ev) => ev[0].lyric))) return;
  const sung: { bar: number; at: number; note: RawNote }[] = [];
  let tiedIn = false;
  bars.forEach((evs, bar) => {
    let pos = 0;
    for (const ev of evs) {
      const n = ev[0];
      const at = n.at ?? pos;
      if (!n.grace) pos = at + n.divs;
      if (n.grace) continue;
      if (!n.rest && !tiedIn) sung.push({ bar, at, note: n });
      tiedIn = !n.rest && ev.some((x) => x.tie);
    }
  });
  let groups = part.measures.flatMap((m, bar) => m.words.filter((w) => w.staff === staff).map((w) => ({ bar, ...w })));
  // One line of words between the staves of a closed score is sung by all four voices.
  if (!groups.length) groups = part.measures.flatMap((m, bar) => m.words.map((w) => ({ bar, ...w })));
  if (!groups.length || !sung.length) return;
  for (const g of groups) {
    const syl = g.text
      .replace(/_+/g, ' ')
      .replace(/\s*-\s*/g, '- ')
      .split(/\s+/)
      .filter((t) => t && t !== '-');
    let k = sung.findIndex((x) => x.bar > g.bar || (x.bar === g.bar && x.at >= g.offset - 1e-6));
    if (k < 0) continue;
    for (const t of syl) {
      if (k >= sung.length) break;
      sung[k++].note.lyric = t;
    }
  }
}

const isAccompaniment = (name: string) => /piano|organ|keyboard|pno|acc(omp)?\b|harmon/i.test(name);

export function musicXmlToReading(xml: string): ScoreReading {
  const doc = parseXml(xml);
  const score = kid(doc, 'score-partwise');
  if (!score) {
    return {
      notation: 'not-music', title: null, composer: null, key: null, time: null, tempo: null, parts: [],
      questions: [], photoProblems: [kid(doc, 'score-timewise') ? 'This MusicXML layout (time-wise) is not supported.' : 'No music was found in the file.'],
    };
  }
  const names = new Map(kids(kid(score, 'part-list'), 'score-part').map((sp) => [sp.attrs.id, txt(sp, 'part-name') ?? '']));
  let parts = kids(score, 'part').map((p) => readPart(p, names.get(p.attrs.id) ?? ''));
  const questions: string[] = [];

  // Leave out the accompaniment.
  const single = parts.filter((p) => p.staffCount === 1);
  if (parts.length > 1 && single.length >= 2 && single.length < parts.length) {
    parts = single;
    questions.push('A piano/organ part was found and left out — only the voice parts were read.');
  } else if (parts.length > 1) {
    const named = parts.filter((p) => !isAccompaniment(p.name));
    if (named.length && named.length < parts.length) {
      parts = named;
      questions.push('A piano/organ part was found and left out — only the voice parts were read.');
    }
  }

  // Open score: if Audiveris missed a staff on one line of music, the parts below it slide up by one
  // (an empty "dummy" part appears). The clefs show it: put each line's parts back where their clef fits.
  if (parts.length >= 4 && parts.every((p) => p.staffCount === 1)) {
    const n = parts[0].measures.length;
    const base = parts.map((p) => p.measures[0]?.clef);
    const starts = [0, ...Array.from({ length: n }, (_, i) => i).filter((i) => i > 0 && parts.some((p) => p.measures[i]?.newSystem))];
    let moved = 0;
    starts.forEach((from, si) => {
      const to = starts[si + 1] ?? n;
      const clefsHere = parts.map((p) => p.measures[from]?.clef);
      const fit = (d: number) => clefsHere.reduce((t, c, j) => t + (j + d >= 0 && j + d < parts.length && c && c === base[j + d] ? 1 : 0), 0);
      const best = [-2, -1, 1, 2].reduce((b, d) => (fit(d) > fit(b) ? d : b), 0);
      if (best === 0 || fit(best) < fit(0) + 2) return;
      const copy = parts.map((p) => p.measures.slice(from, to));
      parts.forEach((p, j) => {
        const src = j - best;
        for (let i = from; i < to; i++) {
          const m = src >= 0 && src < parts.length ? copy[src][i - from] : undefined;
          p.measures[i] = m ? { ...m } : { ...p.measures[i], staves: new Map() };
        }
      });
      moved++;
    });
    if (moved) questions.push(`On ${moved} line${moved > 1 ? 's' : ''} of music Audiveris missed a staff; the parts were put back in place by their clefs — please check those lines.`);
  }

  // Staves in order, top to bottom.
  const slots = parts.flatMap((p) => Array.from({ length: p.staffCount }, (_, i) => ({ part: p, staff: i + 1 })));
  const hasTwoVoices = (slot: (typeof slots)[number]) =>
    slot.part.measures.some((m) => {
      const sv = m.staves.get(slot.staff);
      return !!sv && ([...sv.values()].filter((n) => noteLength(n) > 0).length >= 2 || [...sv.values()].some((n) => n.some((x) => x.chord && !x.rest)));
    });
  const plan: { voice: Voice; slot: (typeof slots)[number]; which: 'all' | 'upper' | 'lower' }[] = [];
  if (slots.length >= 4) {
    (['S', 'A', 'T', 'B'] as Voice[]).forEach((voice, i) => plan.push({ voice, slot: slots[i], which: 'all' }));
    if (slots.length > 4) questions.push(`${slots.length} staves were found; the top four were read as Soprano, Alto, Tenor and Bass.`);
  } else if (slots.length === 3) {
    plan.push({ voice: 'S', slot: slots[0], which: 'all' }, { voice: 'A', slot: slots[1], which: 'all' });
    if (hasTwoVoices(slots[2])) plan.push({ voice: 'T', slot: slots[2], which: 'upper' }, { voice: 'B', slot: slots[2], which: 'lower' });
    else plan.push({ voice: 'B', slot: slots[2], which: 'all' });
  } else if (slots.length === 2) {
    plan.push({ voice: 'S', slot: slots[0], which: 'upper' }, { voice: 'A', slot: slots[0], which: 'lower' });
    plan.push({ voice: 'T', slot: slots[1], which: 'upper' }, { voice: 'B', slot: slots[1], which: 'lower' });
  } else if (slots.length === 1) {
    if (hasTwoVoices(slots[0])) plan.push({ voice: 'S', slot: slots[0], which: 'upper' }, { voice: 'A', slot: slots[0], which: 'lower' });
    else plan.push({ voice: 'S', slot: slots[0], which: 'all' });
  }

  // No time signature found: work out the bar length from the bars themselves (the most common length).
  let guessedTime: string | undefined;
  if (parts.length && !parts.some((p) => p.hasTime)) {
    const counts = new Map<number, number>();
    for (const p of parts) p.measures.forEach((m, i) => {
      if (i === 0 || i === p.measures.length - 1) return;
      for (const sv of m.staves.values()) for (const notes of sv.values()) {
        const l = Math.round(voiceLength(notes) * 8) / 8;
        if (l > 0) counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    });
    const len = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (len) {
      // Compound time (6/8, 12/8): notes keep starting half-way through the 2nd quarter (the 2nd dotted-quarter
      // beat) rather than on the 3rd quarter.
      let mid = 0;
      let third = 0;
      for (const p of parts) for (const m of p.measures) for (const sv of m.staves.values()) for (const ns of sv.values()) for (const n of ns) {
        if (n.chord || n.grace || n.rest || n.at === undefined) continue;
        const at = n.at % 3;
        if (Math.abs(at - 1.5) < 1e-6) mid++;
        else if (Math.abs(at - 2) < 1e-6) third++;
      }
      const dotted = mid > third;
      guessedTime = len === 3 ? (dotted ? '6/8' : '3/4') : len === 1.5 ? '3/8' : len === 4.5 ? '9/8' : len === 6 ? (dotted ? '12/8' : '6/4') : `${len}/4`;
      for (const p of parts) for (const m of p.measures) m.lenDivs = len;
      questions.push(`No time signature was found on the page; the bars look like ${guessedTime}. Please check the "Time:" line.`);
    }
  }

  const first = parts[0];
  const firstMeasure = first?.measures[0];
  const pickup = !!firstMeasure?.implicit;
  let time: string | null = null;
  let tempo: string | null = null;
  // First time signature and tempo, read again from the XML (readPart keeps only changes as directives).
  const attrs = find(kid(score, 'part'), 'attributes');
  const timeEl = find(kid(score, 'part'), 'time');
  if (timeEl && txt(timeEl, 'beats')) time = `${txt(timeEl, 'beats')}/${txt(timeEl, 'beat-type')}`;
  else if (guessedTime) time = guessedTime;
  const keyEl = attrs ? find(kid(score, 'part'), 'key') : undefined;
  const fifths = Number(txt(keyEl, 'fifths') ?? 0);
  const key = keyEl ? (txt(keyEl, 'mode') === 'minor' ? `${MINOR[fifths]} minor` : MAJOR[fifths]) : null;
  if (firstMeasure) {
    const t = firstMeasure.directives.findIndex((d) => d.startsWith('tempo:'));
    if (t >= 0) {
      tempo = firstMeasure.directives[t].slice(6);
      firstMeasure.directives.splice(t, 1);
    }
  }

  const readingParts: ReadingPart[] = plan.map(({ voice, slot, which }) => {
    const clef = slot.part.clefs.get(slot.staff) ?? (voice === 'T' || voice === 'B' ? 'bass' : 'treble');
    const picks = slot.part.measures.map((m, i) => {
      const len = m.lenDivs;
      const pick = pickVoice(m.staves.get(slot.staff), len, which);
      pick.events = pick.events.map((ev) => ev.map((n) => ({ ...n })));
      const got = pick.events.reduce((s, ev) => s + (ev[0].grace ? 0 : ev[0].divs), 0);
      const edge = (i === 0 && m.implicit) || i === slot.part.measures.length - 1;
      const short = pick.events.length > 0 && Math.abs(got - len) > 1e-6 && !edge;
      if (short && got < len) {
        // Missing time at the end of the bar: fill it with a rest (flagged), so the beats line up again.
        pick.events.push([{ ...pick.events[pick.events.length - 1][0], rest: true, pitch: undefined, chord: false, grace: false,
          divs: len - got, type: undefined, dots: 0, tie: false, tupletStart: undefined, tupletEnd: false, lyric: null,
          articulations: [], fermata: false, slur: null, dynamic: null, hairpin: null, at: got }]);
      }
      return { pick, got, len, short };
    });
    placeWords(slot.part, slot.staff, picks.map((p) => p.pick.events));
    const bars: ReadingBar[] = slot.part.measures.map((m, i) => {
      const { pick, got, len, short } = picks[i];
      const problem = [pick.problem, short ? `the notes read here add up to ${got} beats instead of ${len} — some notes or rests may be missing or misread` : undefined]
        .filter(Boolean).join('; ') || null;
      const directives = first.measures[i]?.directives ?? m.directives;
      // MusicXML's octave clef notes are written at sounding pitch; the reading wants the written octave.
      const shift = clef === 'treble8vb' ? 1 : 0;
      return {
        number: pickup ? i : i + 1,
        events: pick.events.length ? toEvents(pick.events, m.fifths, shift) : splitLength(len).map((l) => ({
          kind: 'rest' as const, pitches: [], length: l.type, dots: l.dots, tie: false, grace: false, tupletStart: null, tupletEnd: false,
          articulations: [], fermata: false, dynamic: null, hairpin: null, slur: null, lyric: null, confidence: 1,
        })),
        solfa: null,
        solfaLyrics: null,
        repeatStart: m.repeatStart,
        repeatEnd: m.repeatEnd,
        endBarline: m.endBarline,
        directives,
        unreadable: false,
        problem,
        region: null,
        confidence: short ? 0.6 : 1,
      };
    });
    return { voice, clef, bars };
  });

  // Every voice must have the same number of bars: pad a short part with empty, flagged bars.
  const most = Math.max(0, ...readingParts.map((p) => p.bars.length));
  for (const p of readingParts) {
    while (p.bars.length < most) {
      const ref = readingParts.find((q) => q.bars.length === most)!.bars[p.bars.length];
      p.bars.push({ ...ref, events: [], directives: [...ref.directives], unreadable: true, confidence: 0,
        problem: 'Audiveris found no bar here for this voice' });
    }
  }

  const titleEl = kid(score, 'movement-title') ?? find(kid(score, 'work'), 'work-title');
  const composer = kids(kid(score, 'identification'), 'creator').find((c) => c.attrs.type === 'composer')?.text.trim() || null;
  return {
    notation: readingParts.length ? 'staff' : 'not-music',
    title: titleEl?.text.trim() || null,
    composer,
    key,
    time,
    tempo,
    parts: readingParts,
    questions,
    photoProblems: readingParts.length ? [] : ['No staff notation was found on this page.'],
    reader: 'audiveris',
    timeGuessed: !!guessedTime && time === guessedTime,
  };
}
