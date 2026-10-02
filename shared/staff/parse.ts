// Staff text → Score. A way to TYPE staff notation, note by note, as it is
// written on the page.
//
// Example (Key: G):
//   S: | G4q A4q B4h | F4h~ F4q rq |
//
// Notes:     letter + accidental + octave + length, e.g.  G4q  F#4e.  Bb3h  En4q
//            accidentals:  #  ##  b  bb  n (natural).  Middle C = C4.
//            Write accidentals AS PRINTED: the key signature and earlier
//            accidentals in the bar apply automatically (see accidentals.ts).
//            Pitches are the SOUNDING pitch (tenor middle C = C4, even if the
//            page uses the octave-treble clef).
// Lengths:   w (whole) h (half) q (quarter) e (eighth) s (16th) t (32nd),
//            add . or .. for dotted / double-dotted.
// Rests:     rq  re.  …   R = whole-bar rest
// Ties:      ~ after a note:  G4h~ G4q
// Chords:    <G4 B4>q   (divisi / two notes on one stem)
// Triplets:  (3 C4e D4e E4e)    other tuplets: (5:4 …)
// Grace:     g in front:  gD5s G4q
// Marks and instructions: the same {…} and […] as sol-fa text.

import { add, frac, mul, ZERO, type Frac } from '../model/fraction';
import type { Flag, NoteEvent, Pitch, Score, Step, TimeSig, VoiceId } from '../model/types';
import { VOICE_NAMES } from '../model/types';
import { LETTER_VALUE, notatedLength } from '../convert/duration';
import { accidentalReader } from '../convert/accidentals';
import {
  applyMarks,
  barLength,
  buildHeader,
  buildScore,
  classifyLine,
  collectKeys,
  parseDirective,
  parseHeaderFields,
  parseLyricLine,
  parseMarks,
  splitBars,
  type Directive,
  type LyricItem,
  type RawBar,
  type RawPart,
} from '../textinput/common';

const ACC: Record<string, number> = { '#': 1, '##': 2, b: -1, bb: -2, n: 0 };
const NOTE_RE = /^(g)?([A-G])(##|#|bb|b|n)?(\d)([whqest])(\.{0,2})(~)?/;
const CHORD_RE = /^(g)?<([^>]*)>([whqest])(\.{0,2})(~)?/;
const CHORD_PITCH_RE = /^([A-G])(##|#|bb|b|n)?(\d)$/;
const REST_RE = /^r([whqest])(\.{0,2})/;

interface Tok {
  kind: 'note' | 'rest' | 'barRest';
  written: { step: Step; octave: number; accidental?: number }[];
  length: Frac; // written length (before tuplet adjustment)
  grace: boolean;
  tie: boolean;
  tuplet?: { actual: number; normal: number; group: string };
  marks: ReturnType<typeof parseMarks>['marks'];
}

interface ParsedBar {
  toks: Tok[];
  dirs: { before: number; d: Directive }[]; // `before` = index of the token it comes before
  errors: string[];
}

function parseBarText(text: string, groupPrefix: string): ParsedBar {
  const toks: Tok[] = [];
  const dirs: ParsedBar['dirs'] = [];
  const errors: string[] = [];
  let tuplet: Tok['tuplet'];
  let tupletCount = 0;
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) { i += ws[0].length; continue; }
    if (rest[0] === '[') {
      const end = rest.indexOf(']');
      if (end < 0) { errors.push('Missing "]"'); break; }
      const d = parseDirective(rest.slice(1, end));
      if (typeof d === 'string') errors.push(d);
      else dirs.push({ before: toks.length, d });
      i += end + 1;
      continue;
    }
    if (rest[0] === '{') {
      const end = rest.indexOf('}');
      if (end < 0) { errors.push('Missing "}"'); break; }
      const { marks, unknown } = parseMarks(rest.slice(1, end));
      if (unknown.length) errors.push(`Unknown mark(s): ${unknown.join(', ')}`);
      const last = toks[toks.length - 1];
      if (last) Object.assign(last.marks, marks);
      else errors.push('A {mark} must come after a note');
      i += end + 1;
      continue;
    }
    const tup = /^\((\d+)(?::(\d+))?/.exec(rest);
    if (tup) {
      const actual = Number(tup[1]);
      const normal = tup[2] ? Number(tup[2]) : actual === 3 ? 2 : actual === 2 ? 3 : 2 ** Math.floor(Math.log2(actual));
      tuplet = { actual, normal, group: `${groupPrefix}-t${tupletCount++}` };
      i += tup[0].length;
      continue;
    }
    if (rest[0] === ')') { tuplet = undefined; i++; continue; }
    if (rest[0] === 'R' && !/^R\w/.test(rest)) {
      toks.push({ kind: 'barRest', written: [], length: ZERO, grace: false, tie: false, marks: {} });
      i++;
      continue;
    }
    const len = (letter: string, dots: string) => notatedLength({ base: LETTER_VALUE[letter], dots: dots.length as 0 | 1 | 2 });
    let m = NOTE_RE.exec(rest);
    if (m) {
      toks.push({
        kind: 'note',
        written: [{ step: m[2] as Step, octave: Number(m[4]), accidental: m[3] !== undefined ? ACC[m[3]] : undefined }],
        length: len(m[5], m[6]), grace: !!m[1], tie: !!m[7], tuplet: m[1] ? undefined : tuplet, marks: {},
      });
      i += m[0].length;
      continue;
    }
    m = CHORD_RE.exec(rest);
    if (m) {
      const written: Tok['written'] = [];
      for (const p of m[2].trim().split(/\s+/)) {
        const pm = CHORD_PITCH_RE.exec(p);
        if (pm) written.push({ step: pm[1] as Step, octave: Number(pm[3]), accidental: pm[2] !== undefined ? ACC[pm[2]] : undefined });
        else errors.push(`Could not read "${p}" in chord <${m[2]}>`);
      }
      toks.push({ kind: 'note', written, length: len(m[3], m[4]), grace: !!m[1], tie: !!m[5], tuplet: m[1] ? undefined : tuplet, marks: {} });
      i += m[0].length;
      continue;
    }
    m = REST_RE.exec(rest);
    if (m) {
      toks.push({ kind: 'rest', written: [], length: len(m[1], m[2]), grace: false, tie: false, tuplet, marks: {} });
      i += m[0].length;
      continue;
    }
    const bad = /^\S+/.exec(rest)![0];
    errors.push(`Could not read "${bad}"`);
    i += bad.length;
  }
  if (tuplet) errors.push('A tuplet "(" was not closed with ")"');
  return { toks, dirs, errors };
}

export function parseStaffText(text: string): Score {
  const flags: Flag[] = [];
  const headerLines: string[] = [];
  const partLines = new Map<VoiceId, string[]>();
  const lyricLines = new Map<VoiceId, Map<number, LyricItem[]>>();

  text.split(/\r?\n/).forEach((line, n) => {
    const c = classifyLine(line);
    if (c.kind === 'header') headerLines.push(line);
    else if (c.kind === 'part') {
      if (!partLines.has(c.voice)) partLines.set(c.voice, []);
      partLines.get(c.voice)!.push(c.content);
    } else if (c.kind === 'lyrics') {
      if (!lyricLines.has(c.voice)) lyricLines.set(c.voice, new Map());
      const verses = lyricLines.get(c.voice)!;
      verses.set(c.verse, [...(verses.get(c.verse) ?? []), ...parseLyricLine(c.content)]);
    } else if (c.kind === 'unknown') {
      flags.push({ level: 'warning', code: 'unread-line', message: `Line ${n + 1} was not understood and was skipped: "${line.trim()}".` });
    }
  });
  const header = buildHeader(parseHeaderFields(headerLines), flags);
  if (partLines.size === 0) flags.push({ level: 'error', code: 'no-parts', message: 'No voice parts found. Start each line of music with S:, A:, T: or B:.' });

  // Pass 1: tokens per bar.
  const parsed = new Map<VoiceId, { shell: ReturnType<typeof splitBars>['bars'][number]; bar: ParsedBar }[]>();
  for (const [voice, lines] of partLines) {
    const out: { shell: ReturnType<typeof splitBars>['bars'][number]; bar: ParsedBar }[] = [];
    let carry = false;
    for (const line of lines) {
      const { bars, repeatStartNext } = splitBars(line, carry);
      carry = repeatStartNext;
      for (const shell of bars) {
        const bar = shell.text.trim() === '' ? { toks: [{ kind: 'barRest', written: [], length: ZERO, grace: false, tie: false, marks: {} } as Tok], dirs: [], errors: [] } : parseBarText(shell.text, `${voice}-${out.length}`);
        out.push({ shell, bar });
      }
    }
    parsed.set(voice, out);
  }

  // Time signatures per bar (from any part), then offsets of every token.
  const nBars = Math.max(0, ...[...parsed.values()].map((b) => b.length));
  const times: TimeSig[] = [];
  let t = header.time;
  for (let b = 0; b < nBars; b++) {
    for (const bars of parsed.values()) for (const { d } of bars[b]?.bar.dirs ?? []) if (d.type === 'time') t = d.time;
    times.push(t);
  }
  const soundLength = (tok: Tok) => (tok.tuplet ? mul(tok.length, frac(tok.tuplet.normal, tok.tuplet.actual)) : tok.length);
  const tokOffsets = (b: number, toks: Tok[]) => {
    const offs: Frac[] = [];
    let o = ZERO;
    for (const tok of toks) {
      offs.push(o);
      if (!tok.grace) o = add(o, tok.kind === 'barRest' ? barLength(times[b]) : soundLength(tok));
    }
    offs.push(o);
    return offs;
  };
  const withOffsets = new Map<VoiceId, { directives: { offset: Frac; d: Directive }[] }[]>();
  for (const [voice, bars] of parsed) {
    withOffsets.set(voice, bars.map(({ bar }, b) => {
      const offs = tokOffsets(b, bar.toks);
      return { directives: bar.dirs.map(({ before, d }) => ({ offset: offs[before], d })) };
    }));
  }
  const keys = collectKeys(header, [...withOffsets.values()].map((bars) => ({ bars })));

  // Pass 2: events, with accidentals applied bar by bar.
  const raw: RawPart[] = [];
  for (const [voice, bars] of parsed) {
    const rawBars: RawBar[] = [];
    let prev: NoteEvent | undefined;
    bars.forEach(({ shell, bar }, b) => {
      const where = `${VOICE_NAMES[voice]}, bar ${b + 1}`;
      for (const e of bar.errors) flags.push({ level: 'error', code: 'unreadable', part: voice, measure: b, message: `${where}: ${e}` });
      const offs = tokOffsets(b, bar.toks);
      // Sounding pitches: apply key signature, accidentals and ties, note by note.
      const read = accidentalReader();
      const pitches: Pitch[][] = [];
      bar.toks.forEach((tok, k) => {
        const tiedFrom = k === 0 ? (prev?.tieToNext ? prev.pitches : undefined) : bar.toks[k - 1].tie ? pitches[k - 1] : undefined;
        pitches.push(read({ written: tok.written, key: keys.at(b, offs[k]), tiedFrom }));
      });
      const events: NoteEvent[] = bar.toks.map((tok, k) => {
        const ev: NoteEvent = {
          id: '',
          kind: tok.kind === 'note' ? 'note' : 'rest',
          pitches: pitches[k],
          duration: tok.kind === 'barRest' ? barLength(times[b]) : soundLength(tok),
          confidence: 1,
        };
        if (tok.tuplet) ev.tuplet = tok.tuplet;
        if (tok.grace) ev.grace = true;
        if (tok.tie) ev.tieToNext = true;
        applyMarks(ev, tok.marks);
        return ev;
      });
      // Check ties join the same pitches.
      events.forEach((ev, k) => {
        const next = events.slice(k + 1).find((e) => !e.grace);
        if (ev.tieToNext && next && next.pitches.map((p) => p.step + p.alter + p.octave).join() !== ev.pitches.map((p) => p.step + p.alter + p.octave).join()) {
          flags.push({ level: 'warning', code: 'tie', part: voice, measure: b, message: `${where}: a tie joins two different notes.` });
        }
      });
      rawBars.push({
        events,
        directives: bar.dirs.map(({ before, d }) => ({ offset: offs[before], d })),
        repeatStart: shell.repeatStart, repeatEnd: shell.repeatEnd, doubleBar: shell.doubleBar, finalBar: shell.finalBar,
        unreadable: bar.errors.length > 0,
      });
      prev = events.filter((e) => !e.grace).pop() ?? prev;
    });
    raw.push({ voice, bars: rawBars, lyrics: lyricLines.get(voice) ?? new Map() });
  }
  return buildScore(header, raw, flags, 'typed staff');
}
