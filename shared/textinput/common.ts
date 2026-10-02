// Shared pieces of the two typed input formats (sol-fa text and staff text):
//   - header lines:    Title: … / Composer: … / Key: G / Time: 4/4 / Tempo: Allegro q=90 / Doh: G4
//   - part lines:      S: …   A: …   T: …   B: …   (repeat a label to continue on a new line)
//   - lyric lines:     S-lyrics: A-bide with me _ fast falls   (S-lyrics-2: for verse 2)
//   - bar directives:  [key:D] [time:3/4] [tempo:Andante q=72] [rit] [accel] [a tempo]
//                      [segno] [coda] [tocoda] [fine] [D.C. al Fine] [D.S. al Coda] …
//                      [ending:1] [ending:2] [/ending]
//   - note marks:      {p} {ff} {stacc} {acc} {ten} {ferm} {cresc} {dim} {/hp} {(} {)} {ped} {*} {conf=0.6}
//   - bar lines:       |   ||   |]   ||:   :||   :||:
// See CLAUDE.md for the full description.

import { add, eq, frac, lt, sum, ZERO, type Frac } from '../model/fraction';
import type {
  Articulation,
  Dynamic,
  Flag,
  Jump,
  Key,
  LyricSyllable,
  MeasureInfo,
  NoteEvent,
  Part,
  Score,
  ScoreMeta,
  Tempo,
  TempoChange,
  TimeSig,
  VoiceId,
} from '../model/types';
import { VOICE_NAMES, VOICE_ORDER } from '../model/types';
import { keyLabel, parseKey, parsePitch, sameKey } from '../convert/pitch';
import { LETTER_VALUE, notatedLength } from '../convert/duration';

// ---------- Header ----------

export interface Header {
  meta: ScoreMeta;
  key: Key;
  time: TimeSig;
  tempo?: Tempo;
  dohOctave?: number;
}

const HEADER_LABELS = ['Title', 'Composer', 'Arranger', 'Key', 'Time', 'Tempo', 'Doh'];
const HEADER_RE = new RegExp(`(?:^|\\s)(${HEADER_LABELS.join('|')})\\s*:`, 'gi');

/** Is this line a header line (starts with a known label)? */
export const isHeaderLine = (line: string) =>
  new RegExp(`^\\s*(${HEADER_LABELS.join('|')})\\s*:`, 'i').test(line);

/** Read "Title: X   Key: G   Time: 4/4" style fields (several may share a line). */
export function parseHeaderFields(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const hits = [...line.matchAll(HEADER_RE)];
    hits.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < hits.length ? hits[i + 1].index! : line.length;
      out[m[1].toLowerCase()] = line.slice(start, end).trim();
    });
  }
  return out;
}

export function buildHeader(fields: Record<string, string>, flags: Flag[]): Header {
  let key: Key = { doh: { step: 'C', alter: 0 }, mode: 'major' };
  let dohOctave: number | undefined;
  if (fields.doh) {
    // "Doh: G4" sets both the key (if not given) and the octave of doh.
    const p = parsePitch(fields.doh);
    if (p) {
      dohOctave = p.octave;
      if (!fields.key) key = { doh: { step: p.step, alter: p.alter }, mode: 'major' };
    } else {
      const k = parseKey(fields.doh);
      if (k && !fields.key) key = k;
      else if (!k) flags.push({ level: 'warning', code: 'header', message: `Could not read "Doh: ${fields.doh}". Example: "Doh: G4".` });
    }
  }
  if (fields.key) {
    const k = parseKey(fields.key);
    if (k) key = k;
    else flags.push({ level: 'error', code: 'header', message: `Could not read the key "${fields.key}". Examples: "G", "Eb", "A minor".` });
  } else if (!fields.doh) {
    flags.push({ level: 'warning', code: 'header', message: 'No key given; assuming C major (Doh = C). Add a line like "Key: G".' });
  }

  let time: TimeSig = { beats: 4, beatType: 4 };
  if (fields.time) {
    const t = parseTime(fields.time);
    if (t) time = t;
    else flags.push({ level: 'error', code: 'header', message: `Could not read the time signature "${fields.time}". Example: "3/4".` });
  } else {
    flags.push({ level: 'warning', code: 'header', message: 'No time signature given; assuming 4/4. Add a line like "Time: 3/4".' });
  }

  let tempo: Tempo | undefined;
  if (fields.tempo) {
    tempo = parseTempo(fields.tempo);
    if (!tempo) flags.push({ level: 'warning', code: 'header', message: `Could not read the tempo "${fields.tempo}". Example: "Andante q=72".` });
  }

  return {
    meta: { title: fields.title || 'Untitled', composer: fields.composer, arranger: fields.arranger },
    key,
    time,
    tempo,
    dohOctave,
  };
}

export function parseTime(text: string): TimeSig | undefined {
  const t = text.trim();
  if (/^c$/i.test(t)) return { beats: 4, beatType: 4 };
  if (/^c\|$/i.test(t)) return { beats: 2, beatType: 2 };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (!m) return undefined;
  const beats = Number(m[1]);
  const beatType = Number(m[2]);
  if (beats < 1 || ![1, 2, 4, 8, 16, 32].includes(beatType)) return undefined;
  return { beats, beatType };
}

/** "Allegro q=90", "q.=60", "90", "Andante". */
export function parseTempo(text: string): Tempo | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const m = /(?:^|\s)(?:([whqes])(\.?)\s*=\s*)?(\d{2,3})\s*$/.exec(t);
  if (m) {
    const words = t.slice(0, m.index).trim();
    let unit: Frac = frac(1, 4);
    if (m[1]) unit = notatedLength({ base: LETTER_VALUE[m[1]], dots: m[2] ? 1 : 0 });
    return { bpm: Number(m[3]), beatUnit: unit, text: words || undefined };
  }
  if (/^[A-Za-z][A-Za-z .]*$/.test(t)) return { text: t };
  return undefined;
}

// ---------- Part and lyric lines ----------

const VOICE_ALIASES: Record<string, VoiceId> = {
  s: 'S', soprano: 'S', a: 'A', alto: 'A', t: 'T', tenor: 'T', b: 'B', bass: 'B',
};

export type LineKind =
  | { kind: 'part'; voice: VoiceId; content: string }
  | { kind: 'lyrics'; voice: VoiceId; verse: number; content: string }
  | { kind: 'header' }
  | { kind: 'blank' }
  | { kind: 'unknown' };

export function classifyLine(line: string): LineKind {
  const t = line.trim();
  if (!t || t.startsWith('%') || t.startsWith('//')) return { kind: 'blank' };
  const lyr = /^(soprano|alto|tenor|bass|[satb])?[ -]?(lyrics|words)(?:[ -]?(\d+))?\s*:(.*)$/i.exec(t);
  if (lyr) {
    const voice = lyr[1] ? VOICE_ALIASES[lyr[1].toLowerCase()] : 'S';
    return { kind: 'lyrics', voice, verse: lyr[3] ? Number(lyr[3]) : 1, content: lyr[4] };
  }
  const part = /^(soprano|alto|tenor|bass|[satb])\s*:(.*)$/i.exec(t);
  if (part) return { kind: 'part', voice: VOICE_ALIASES[part[1].toLowerCase()], content: part[2] };
  if (isHeaderLine(t)) return { kind: 'header' };
  return { kind: 'unknown' };
}

// ---------- Bar directives ----------

export type Directive =
  | { type: 'key'; key: Key }
  | { type: 'time'; time: TimeSig }
  | { type: 'tempo'; tempo: Tempo }
  | { type: 'tempoChange'; kind: TempoChange }
  | { type: 'segno' | 'coda' | 'toCoda' | 'fine' | 'endingClose' }
  | { type: 'jump'; jump: Jump }
  | { type: 'ending'; numbers: number[] };

const JUMPS: Record<string, Jump> = {
  'd.c.': 'D.C.', dc: 'D.C.', 'da capo': 'D.C.',
  'd.c. al fine': 'D.C. al Fine', 'dc al fine': 'D.C. al Fine',
  'd.c. al coda': 'D.C. al Coda', 'dc al coda': 'D.C. al Coda',
  'd.s.': 'D.S.', ds: 'D.S.', 'dal segno': 'D.S.',
  'd.s. al fine': 'D.S. al Fine', 'ds al fine': 'D.S. al Fine',
  'd.s. al coda': 'D.S. al Coda', 'ds al coda': 'D.S. al Coda',
};

/** Parse the inside of a [...] directive. Returns an error message string if unreadable. */
export function parseDirective(inner: string): Directive | string {
  const t = inner.trim();
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  const kv = /^(key|time|tempo|ending)\s*:\s*(.*)$/i.exec(t);
  if (kv) {
    const val = kv[2];
    switch (kv[1].toLowerCase()) {
      case 'key': {
        const key = parseKey(val);
        return key ? { type: 'key', key } : `Could not read key "${val}"`;
      }
      case 'time': {
        const time = parseTime(val);
        return time ? { type: 'time', time } : `Could not read time signature "${val}"`;
      }
      case 'tempo': {
        const tempo = parseTempo(val);
        return tempo ? { type: 'tempo', tempo } : `Could not read tempo "${val}"`;
      }
      case 'ending': {
        const nums = val.split(/[,\s]+/).filter(Boolean).map(Number);
        return nums.length && nums.every((n) => n >= 1)
          ? { type: 'ending', numbers: nums }
          : `Could not read ending "${val}" (example: [ending:1])`;
      }
    }
  }
  if (lower === '/ending') return { type: 'endingClose' };
  if (['rit', 'rit.', 'ritardando', 'rall', 'rall.', 'rallentando'].includes(lower)) return { type: 'tempoChange', kind: 'rit' };
  if (['accel', 'accel.', 'accelerando'].includes(lower)) return { type: 'tempoChange', kind: 'accel' };
  if (lower === 'a tempo') return { type: 'tempoChange', kind: 'a tempo' };
  if (lower === 'segno') return { type: 'segno' };
  if (lower === 'coda') return { type: 'coda' };
  if (['tocoda', 'to coda'].includes(lower)) return { type: 'toCoda' };
  if (lower === 'fine') return { type: 'fine' };
  if (JUMPS[lower]) return { type: 'jump', jump: JUMPS[lower] };
  return `Unknown instruction [${t}]`;
}

// ---------- Note marks {…} ----------

export type NoteMarks = Partial<
  Pick<NoteEvent, 'articulations' | 'fermata' | 'dynamic' | 'hairpin' | 'slurStart' | 'slurEnd' | 'pedal' | 'confidence'>
>;

const ARTIC: Record<string, Articulation> = {
  stacc: 'staccato', staccato: 'staccato', '.': 'staccato',
  acc: 'accent', accent: 'accent', '>': 'accent',
  ten: 'tenuto', tenuto: 'tenuto', _: 'tenuto',
  marc: 'marcato', marcato: 'marcato', '^': 'marcato',
};
const DYNAMICS: Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sf', 'sfz', 'fp'];

/** Parse "p, stacc" etc. Unknown words are returned so they can be flagged. */
export function parseMarks(inner: string): { marks: NoteMarks; unknown: string[] } {
  const marks: NoteMarks = {};
  const unknown: string[] = [];
  for (const w of inner.split(/[\s,]+/).filter(Boolean)) {
    const lw = w.toLowerCase();
    if (ARTIC[lw]) (marks.articulations ??= []).push(ARTIC[lw]);
    else if (DYNAMICS.includes(w as Dynamic)) marks.dynamic = w as Dynamic;
    else if (['ferm', 'fermata', 'u'].includes(lw)) marks.fermata = true;
    else if (['cresc', '<'].includes(lw)) marks.hairpin = 'cresc';
    else if (['dim', 'decresc'].includes(lw)) marks.hairpin = 'dim';
    else if (['/hp', '/cresc', '/dim', 'end'].includes(lw)) marks.hairpin = 'end';
    else if (lw === '(') marks.slurStart = true;
    else if (lw === ')') marks.slurEnd = true;
    else if (lw === 'ped') marks.pedal = 'down';
    else if (['*', '/ped'].includes(lw)) marks.pedal = 'up';
    else if (lw === '?') marks.confidence = 0.5;
    else if (/^conf=(0(\.\d+)?|1(\.0+)?)$/.test(lw)) marks.confidence = Number(lw.slice(5));
    else unknown.push(w);
  }
  return { marks, unknown };
}

export function applyMarks(ev: NoteEvent, marks: NoteMarks) {
  if (marks.articulations) ev.articulations = [...(ev.articulations ?? []), ...marks.articulations];
  for (const k of ['fermata', 'dynamic', 'hairpin', 'slurStart', 'slurEnd', 'pedal', 'confidence'] as const) {
    if (marks[k] !== undefined) (ev as unknown as Record<string, unknown>)[k] = marks[k];
  }
}

// ---------- Lyrics ----------

export type LyricItem =
  | { kind: 'syl'; text: string; syllabic: LyricSyllable['syllabic'] }
  | { kind: 'extend' } // "_" : previous syllable continues over one more note (melisma)
  | { kind: 'skip' }; // "*" : this note has no syllable

/** "A-bide with me _ fast" → syllables. A hyphen joins syllables of one word. */
export function parseLyricLine(text: string): LyricItem[] {
  const out: LyricItem[] = [];
  let inWord = false; // previous token ended with "-"
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    if (tok === '_') { out.push({ kind: 'extend' }); continue; }
    if (tok === '*') { out.push({ kind: 'skip' }); continue; }
    if (tok === '-') { inWord = true; continue; }
    const pieces = tok.split('-');
    const endsOpen = tok.endsWith('-');
    const syls = pieces.filter((p) => p !== '');
    syls.forEach((s, i) => {
      const first = i === 0 && !inWord;
      const last = i === syls.length - 1 && !endsOpen;
      const syllabic = first && last ? 'single' : first ? 'begin' : last ? 'end' : 'middle';
      out.push({ kind: 'syl', text: s.replace(/~/g, ' '), syllabic });
    });
    inWord = endsOpen;
  }
  return out;
}

/** Notes that can carry a lyric: real notes, not grace notes, not the second half of a tie. */
export function lyricTargets(part: Part): NoteEvent[] {
  const out: NoteEvent[] = [];
  let tiedIn = false;
  for (const m of part.measures) {
    for (const ev of m.events) {
      if (ev.kind === 'note' && !ev.grace && !tiedIn) out.push(ev);
      if (!ev.grace) tiedIn = ev.kind === 'note' && !!ev.tieToNext;
    }
  }
  return out;
}

export function assignLyrics(part: Part, verse: number, items: LyricItem[], flags: Flag[]) {
  const targets = lyricTargets(part);
  let ti = 0;
  let last: LyricSyllable | undefined;
  for (const item of items) {
    if (ti >= targets.length) {
      flags.push({
        level: 'warning', code: 'lyrics', part: part.id,
        message: `${part.name} verse ${verse}: more lyric syllables than notes. Extra words were not placed.`,
      });
      return;
    }
    const ev = targets[ti++];
    if (item.kind === 'syl') {
      last = { verse, text: item.text, syllabic: item.syllabic };
      (ev.lyrics ??= []).push(last);
    } else if (item.kind === 'extend') {
      if (last) last.extend = true;
    }
  }
}

// ---------- Building the score from parsed bars ----------

export interface RawBar {
  events: NoteEvent[];
  directives: { offset: Frac; d: Directive }[];
  repeatStart?: boolean;
  repeatEnd?: boolean;
  doubleBar?: boolean;
  finalBar?: boolean;
  /** Bar contained something that could not be read. */
  unreadable?: boolean;
}

export interface RawPart {
  voice: VoiceId;
  bars: RawBar[];
  lyrics: Map<number, LyricItem[]>;
}

export const barLength = (t: TimeSig) => frac(t.beats, t.beatType);

/**
 * The key in force at every (bar, offset) point, gathered from ALL parts
 * (a key change written on any one part applies to the whole score).
 */
export class KeyMap {
  private changes: { bar: number; offset: Frac; key: Key }[] = [];
  constructor(public initial: Key) {}
  add(bar: number, offset: Frac, key: Key) {
    if (!this.changes.some((c) => c.bar === bar && eq(c.offset, offset))) {
      this.changes.push({ bar, offset, key });
      this.changes.sort((a, b) => a.bar - b.bar || (lt(a.offset, b.offset) ? -1 : 1));
    }
  }
  /** Key in force at this point (a change AT this offset counts). */
  at(bar: number, offset: Frac): Key {
    let k = this.initial;
    for (const c of this.changes) {
      if (c.bar < bar || (c.bar === bar && !lt(offset, c.offset))) k = c.key;
    }
    return k;
  }
  /** Key in force just BEFORE this point. */
  before(bar: number, offset: Frac): Key {
    let k = this.initial;
    for (const c of this.changes) {
      if (c.bar < bar || (c.bar === bar && lt(c.offset, offset))) k = c.key;
    }
    return k;
  }
  /** The key a staff key signature shows in this bar (changes exactly at the bar line). */
  signatureAt(bar: number): Key {
    return this.at(bar, ZERO);
  }
}

/** Gather key changes from every part's directives. */
export function collectKeys(header: Header, parts: { bars: { directives: { offset: Frac; d: Directive }[] }[] }[]) {
  const km = new KeyMap(header.key);
  for (const p of parts) {
    p.bars.forEach((bar, i) => {
      for (const { offset, d } of bar.directives) if (d.type === 'key') km.add(i, offset, d.key);
    });
  }
  return km;
}

export function buildScore(header: Header, raw: RawPart[], flags: Flag[], source: string): Score {
  const nBars = Math.max(0, ...raw.map((p) => p.bars.length));
  const measures: MeasureInfo[] = [];
  let time = header.time;
  let key = header.key;
  // Which part first set each bar-level value (to report conflicts).
  const conflict = (i: number, what: string) =>
    flags.push({ level: 'warning', code: 'directive-conflict', measure: i, message: `Bar ${i + 1}: parts disagree about the ${what}. Using the first one.` });

  for (let i = 0; i < nBars; i++) {
    const m: MeasureInfo = { index: i, number: i + 1, time, key };
    const keyChanges: { offset: Frac; key: Key }[] = [];
    let closeEnding = false;
    for (const p of raw) {
      const bar = p.bars[i];
      if (!bar) continue;
      if (bar.repeatStart) m.repeatStart = true;
      if (bar.repeatEnd) m.repeatEnd = true;
      if (bar.doubleBar) m.doubleBar = true;
      if (bar.finalBar) m.finalBar = true;
      for (const { offset, d } of bar.directives) {
        switch (d.type) {
          case 'time':
            if (offset.n !== 0) flags.push({ level: 'warning', code: 'directive', part: p.voice, measure: i, message: `Bar ${i + 1}: a time signature change must be at the start of a bar.` });
            if (m.timeChanged && (m.time.beats !== d.time.beats || m.time.beatType !== d.time.beatType)) conflict(i, 'time signature');
            else { m.time = d.time; m.timeChanged = true; }
            break;
          case 'key': {
            const same = keyChanges.find((k) => eq(k.offset, offset));
            if (!same) keyChanges.push({ offset, key: d.key });
            else if (!sameKey(same.key, d.key)) conflict(i, 'key');
            break;
          }
          case 'tempo':
            if (m.tempo && JSON.stringify(m.tempo) !== JSON.stringify(d.tempo)) conflict(i, 'tempo');
            else m.tempo = d.tempo;
            break;
          case 'tempoChange':
            if (!m.tempoChanges?.some((c) => c.kind === d.kind)) (m.tempoChanges ??= []).push({ offset, kind: d.kind });
            break;
          case 'segno': m.segno = true; break;
          case 'coda': m.coda = true; break;
          case 'toCoda': m.toCoda = true; break;
          case 'fine': m.fine = true; break;
          case 'jump':
            if (m.jump && m.jump !== d.jump) conflict(i, 'D.C./D.S. instruction');
            else m.jump = d.jump;
            break;
          case 'ending':
            if (m.ending && m.ending.numbers.join() !== d.numbers.join()) conflict(i, 'ending number');
            else m.ending = { numbers: d.numbers, start: true, end: false };
            break;
          case 'endingClose': closeEnding = true; break;
        }
      }
    }
    if (keyChanges.length) {
      keyChanges.sort((a, b) => (lt(a.offset, b.offset) ? -1 : 1));
      m.keyChanges = keyChanges;
      if (keyChanges[0].offset.n === 0) m.key = keyChanges[0].key;
      key = keyChanges[keyChanges.length - 1].key;
    }
    if (closeEnding) (m as MeasureInfo & { _close?: boolean })._close = true;
    time = m.time;
    measures.push(m);
  }
  if (header.tempo && measures[0] && !measures[0].tempo) measures[0].tempo = header.tempo;

  resolveEndings(measures, flags);

  const parts: Part[] = VOICE_ORDER.filter((v) => raw.some((p) => p.voice === v)).map((v) => {
    const rp = raw.find((p) => p.voice === v)!;
    const part: Part = {
      id: v,
      name: VOICE_NAMES[v],
      staff: v === 'S' || v === 'A' ? 'upper' : 'lower',
      stem: v === 'S' || v === 'T' ? 'up' : 'down',
      measures: rp.bars.map((b, i) => ({
        events: b.events.map((ev, k) => ({ ...ev, id: `${v}-m${i}-e${k}` })),
      })),
    };
    for (const [verse, items] of rp.lyrics) assignLyrics(part, verse, items, flags);
    return part;
  });

  // Pickup (anacrusis): a short first bar.
  if (measures.length > 1) {
    const firstLen = Math.max(...parts.map((p) => {
      const evs = p.measures[0]?.events ?? [];
      const s = sum(evs.filter((e) => !e.grace).map((e) => e.duration));
      return s.n / s.d;
    }));
    const full = barLength(measures[0].time);
    if (firstLen > 0 && firstLen < full.n / full.d) {
      measures[0].pickup = true;
      measures.forEach((m) => (m.number = m.index));
      flags.push({ level: 'info', code: 'pickup', measure: 0, message: 'The first bar is short, so it is treated as a pickup (anacrusis) bar, numbered 0. If it is not meant to be a pickup, it is missing beats — please check it.' });
    }
  }

  // Single key-change note for the summary.
  for (const m of measures) {
    for (const kc of m.keyChanges ?? []) {
      flags.push({ level: 'info', code: 'key-change', measure: m.index, message: `Bar ${m.number}: key changes to ${keyLabel(kc.key)}.` });
    }
  }

  return { meta: { ...header.meta, source }, measures, parts, flags, dohOctave: header.dohOctave };
}

/** Work out where each first/second ending bracket stops. */
function resolveEndings(measures: (MeasureInfo & { _close?: boolean })[], flags: Flag[]) {
  let prevLen = 1;
  for (let s = 0; s < measures.length; s++) {
    const m = measures[s];
    if (!m.ending?.start) continue;
    const isFirst = m.ending.numbers.includes(1);
    let e = -1;
    // 1) An explicit [/ending] before the next ending or repeat section.
    for (let j = s; j < measures.length; j++) {
      if (j > s && (measures[j].ending?.start || measures[j].repeatStart)) break;
      if (measures[j]._close) { e = j; break; }
    }
    if (e < 0) {
      for (let j = s; j < measures.length; j++) {
        if (j > s && measures[j].ending?.start) { e = j - 1; break; }
        if (measures[j].repeatEnd) { e = j; break; }
        if (!isFirst && j - s + 1 >= prevLen) { e = j; break; }
      }
    }
    if (e < 0) {
      e = s;
      flags.push({ level: 'warning', code: 'repeat', measure: s, message: `Bar ${s + 1}: ending ${m.ending.numbers.join(',')} has no repeat sign to close it; assuming it is one bar long.` });
    }
    for (let j = s; j <= e; j++) {
      measures[j].ending = { numbers: m.ending.numbers, start: j === s, end: j === e };
    }
    if (isFirst) prevLen = e - s + 1;
    s = e;
  }
  for (const m of measures) delete m._close;
}

/** Sum of the (non-grace) note lengths in a bar. */
export const eventsLength = (events: NoteEvent[]) => events.filter((e) => !e.grace).reduce((a, e) => add(a, e.duration), ZERO);

// ---------- Splitting a part line into bars ----------

export interface BarText {
  text: string;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  doubleBar?: boolean;
  finalBar?: boolean;
}

const BARLINES = [':||:', ':||', '||:', '|]', '||', '|'];

/**
 * Cut "| d :r || m :f :||" into bars. Text inside [...] and {...} is never
 * treated as a bar line. Blank space between two bar lines in the middle of a
 * line is kept (it is a whole-bar rest); blank space at the ends is ignored.
 * `repeatStart` carries a "||:" from the end of the previous line.
 */
export function splitBars(content: string, repeatStart = false): { bars: BarText[]; repeatStartNext: boolean } {
  const bars: BarText[] = [];
  let cur: BarText = { text: '', repeatStart: repeatStart || undefined };
  let depth = 0;
  let sawBarline = false;
  for (let i = 0; i < content.length; ) {
    const ch = content[i];
    const tok = depth === 0 ? BARLINES.find((b) => content.startsWith(b, i)) : undefined;
    if (!tok) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      cur.text += ch;
      i++;
      continue;
    }
    const atLineStart = !sawBarline && cur.text.trim() === '';
    sawBarline = true;
    i += tok.length;
    if (atLineStart) {
      // A bar line at the start of a line only opens the first bar.
      if (tok.endsWith('||:')) cur.repeatStart = true;
      continue;
    }
    if (tok.startsWith(':')) cur.repeatEnd = true;
    if (tok.includes('||')) cur.doubleBar = true;
    if (tok === '|]') cur.finalBar = true;
    bars.push(cur);
    cur = { text: '', repeatStart: tok.endsWith('||:') || undefined };
  }
  if (cur.text.trim() !== '') bars.push(cur);
  return { bars, repeatStartNext: cur.text.trim() === '' && !!cur.repeatStart };
}
