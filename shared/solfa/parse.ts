// Sol-fa text → Score.
//
// Example:
//   Title: Old Hundredth
//   Key: G   Time: 4/4   Tempo: 80
//   S: | d :- :d :- | t, :- :l, :- |
//   S-lyrics: All peo-ple
//
// Time marks inside a bar:
//   :  (or !)  separates pulses (beats). In 4/4 there are 4 pulses, in 6/8 six.
//   .          splits a pulse in half:          d.r   = two half-pulses
//   ,          splits into quarters:            d,r.m = quarter, quarter, half
//   .,         "d.,r" = d for 3/4 of the pulse, r for the last quarter
//   two dots   "d.r.m" = a triplet (three thirds of the pulse)
//   -          hold the previous note (across pulses and bar lines = a tie)
//   blank      rest
// Octaves: d' (higher), d, (lower), also d¹ d² d₁ d₂.
//   A comma straight after a note is an octave mark, unless another note
//   follows in the same pulse: then the LAST comma is the quarter-pulse divider
//   ("d,,r" = low d then r). Use subscripts (d₁) if you want to avoid doubt.
// Key changes: [key:D] s/d  — the bridge note "s/d" is s in the old key = d in the new key.

import { add, div, frac, lt, mul, sub, ZERO, type Frac } from '../model/fraction';
import type { Flag, Key, NoteEvent, Pitch, Score, TimeSig, VoiceId } from '../model/types';
import { VOICE_NAMES } from '../model/types';
import { defaultDohOctave, midi, pitchClassSemitone, sameKey, solfaToPitch, SYLLABLES } from '../convert/pitch';
import {
  applyMarks,
  barLength,
  buildHeader,
  buildScore,
  classifyLine,
  KeyMap,
  parseDirective,
  parseHeaderFields,
  parseLyricLine,
  parseMarks,
  splitBars,
  type BarText,
  type Directive,
  type LyricItem,
  type NoteMarks,
  type RawBar,
  type RawPart,
} from '../textinput/common';

// ---------- One pulse ----------

export interface PulseItem {
  /** Position inside the pulse: 0, 1/4, 1/3, 1/2, 2/3, 3/4. */
  pos: Frac;
  kind: 'note' | 'hold' | 'rest' | 'skip';
  syllable?: string;
  /** Bridge note: syllable in the old key ("s" in "s/d"). */
  bridge?: string;
  octave?: number;
  /** Extra notes sounding with this one (divisi), written "m+d". */
  chord?: { syllable: string; octave: number }[];
  marks: NoteMarks;
  directives: Directive[];
}

export interface PulseResult {
  items: PulseItem[];
  errors: string[];
}

const SYL_NAMES = Object.keys(SYLLABLES).sort((a, b) => b.length - a.length);
const SUPER: Record<string, number> = { '¹': 1, '²': 2, '³': 3 };
const SUB: Record<string, number> = { '₁': 1, '₂': 2, '₃': 3 };
const isNoteStart = (c: string | undefined) => !!c && (/[drmfslt]/.test(c) || c === '-');

/** Parse the text of one pulse, e.g. "d.,r" or "s,.l," or "[key:D]s/d". */
export function parsePulse(raw: string): PulseResult {
  const errors: string[] = [];
  // 1) Take out [directives] but remember where they were.
  const dirs: { at: number; d: Directive }[] = [];
  let text = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '[') {
      const end = raw.indexOf(']', i);
      if (end < 0) { errors.push(`Missing "]" in "${raw}"`); break; }
      const d = parseDirective(raw.slice(i + 1, end));
      if (typeof d === 'string') errors.push(d);
      else dirs.push({ at: text.length, d });
      i = end;
    } else text += raw[i];
  }

  // 2) Read elements and separators.
  type Head = { syllable: string; octave: number };
  type El = {
    kind: PulseItem['kind']; at: number; syllable?: string; bridge?: string; octave?: number;
    chord: Head[]; marks: NoteMarks; empty: boolean; spaced: boolean;
  };
  const els: El[] = [];
  const seps: string[] = [];
  let i = 0;
  const skipSpace = () => { while (text[i] === ' ' || text[i] === '\t') i++; };

  const readSyllable = (): string | undefined => {
    const name = SYL_NAMES.find((n) => text.startsWith(n, i));
    if (name) i += name.length;
    return name;
  };
  const readOctave = (): number => {
    let oct = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "'" || c === '’') { oct++; i++; }
      else if (SUPER[c]) { oct += SUPER[c]; i++; }
      else if (SUB[c]) { oct -= SUB[c]; i++; }
      else if (c === ',') {
        let j = i;
        while (text[j] === ',') j++;
        const run = j - i;
        let k = j;
        while (text[k] === ' ') k++;
        if (isNoteStart(text[k])) {
          // Another note follows in this pulse, so the last comma divides the pulse.
          oct -= run - 1;
          i = j - 1;
        } else {
          oct -= run;
          i = j;
        }
        break;
      } else break;
    }
    return oct;
  };

  while (true) {
    const before = i;
    skipSpace();
    const el: El = { kind: 'rest', at: i, chord: [], marks: {}, empty: true, spaced: i > before };
    const syl = readSyllable();
    if (syl) {
      el.kind = 'note';
      el.empty = false;
      el.syllable = syl;
      if (text[i] === '/') {
        i++;
        const second = readSyllable();
        if (second) { el.bridge = syl; el.syllable = second; }
        else errors.push(`Bridge note "${syl}/" needs a syllable after "/"`);
      }
      el.octave = readOctave();
      // Divisi: "m+d" = two notes sounding together.
      while (text[i] === '+') {
        i++;
        const extra = readSyllable();
        if (!extra) { errors.push(`"+" must be followed by a syllable in "${raw.trim()}"`); break; }
        el.chord.push({ syllable: extra, octave: readOctave() });
      }
    } else if (text[i] === '-') {
      el.kind = 'hold';
      el.empty = false;
      i++;
    }
    // Marks {...} (may follow a note, a hold, or stand alone on a rest).
    skipSpace();
    while (text[i] === '{') {
      const end = text.indexOf('}', i);
      if (end < 0) { errors.push(`Missing "}" in "${raw}"`); i = text.length; break; }
      const { marks, unknown } = parseMarks(text.slice(i + 1, end));
      Object.assign(el.marks, marks);
      if (unknown.length) errors.push(`Unknown mark(s): ${unknown.join(', ')}`);
      i = end + 1;
      skipSpace();
    }
    els.push(el);
    skipSpace();
    if (i >= text.length) break;
    if (text[i] === '.' || text[i] === ',') {
      seps.push(text[i]);
      i++;
      continue;
    }
    errors.push(`Could not read "${text.slice(i)}" in "${raw.trim()}"`);
    break;
  }

  // 3) Work out the position of every separator.
  const dots = seps.filter((s) => s === '.').length;
  const commas = seps.length - dots;
  const positions: Frac[] = [ZERO];
  if (commas === 0 && dots === 2) positions.push(frac(1, 3), frac(2, 3));
  else if (dots > 1) errors.push(`Too many "." in one pulse: "${raw.trim()}"`);
  else {
    let seenDot = false;
    for (const s of seps) {
      if (s === '.') { seenDot = true; positions.push(frac(1, 2)); }
      else positions.push(seenDot ? frac(3, 4) : frac(1, 4));
    }
    for (let k = 1; k < positions.length; k++) {
      if (!lt(positions[k - 1], positions[k])) { errors.push(`Pulse divisions out of order in "${raw.trim()}"`); break; }
    }
  }

  // 4) Make the items. Nothing at all BETWEEN two separators means "no new
  //    note here" (the gap in "d.,r"). A blank space there, or an empty
  //    element at either end, is a rest.
  const items: PulseItem[] = els.slice(0, positions.length).map((el, k) => {
    let kind = el.kind;
    if (el.empty && !el.spaced && k > 0 && k < els.length - 1) kind = 'skip';
    return {
      pos: positions[k], kind, syllable: el.syllable, bridge: el.bridge, octave: el.octave,
      chord: el.chord.length ? el.chord : undefined, marks: el.marks, directives: [],
    };
  });
  // Attach directives to the first element at or after where they were written.
  for (const { at, d } of dirs) {
    const target = items.find((_, k) => els[k].at >= at) ?? items[items.length - 1];
    target?.directives.push(d);
  }
  return { items, errors };
}

/** Split the text of one bar into pulses at ":" and "!" (not inside [] or {}). */
export function splitPulses(barText: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of barText) {
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ':' || ch === '!')) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------- Whole document ----------

interface ParsedBar {
  shell: BarText;
  pulses: PulseItem[][];
  wholeRest: boolean;
  errors: string[];
}

export function parseSolfa(text: string): Score {
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
      flags.push({ level: 'warning', code: 'unread-line', message: `Line ${n + 1} was not understood and was skipped: "${line.trim()}". Lines should start with S:, A:, T:, B:, a lyrics label, or a header like Key:.` });
    }
  });

  const header = buildHeader(parseHeaderFields(headerLines), flags);
  if (partLines.size === 0) {
    flags.push({ level: 'error', code: 'no-parts', message: 'No voice parts found. Start each line of music with S:, A:, T: or B:.' });
  }

  // Pass 1: bars → pulses → items (no pitches yet).
  const parsed = new Map<VoiceId, ParsedBar[]>();
  for (const [voice, lines] of partLines) {
    const bars: ParsedBar[] = [];
    let carry = false;
    for (const line of lines) {
      const { bars: shells, repeatStartNext } = splitBars(line, carry);
      carry = repeatStartNext;
      for (const shell of shells) {
        const errors: string[] = [];
        if (shell.text.trim() === '') {
          bars.push({ shell, pulses: [], wholeRest: true, errors });
          continue;
        }
        let pulseTexts = splitPulses(shell.text);
        // Pickup bar written as ":s |" — drop the empty first pulse.
        if (bars.length === 0 && pulseTexts.length > 1 && pulseTexts[0].trim() === '') {
          const beats = header.time.beats;
          if (pulseTexts.length < beats) pulseTexts = pulseTexts.slice(1);
        }
        const pulses = pulseTexts.map((p) => {
          const r = parsePulse(p);
          errors.push(...r.errors);
          return r.items;
        });
        bars.push({ shell, pulses, wholeRest: false, errors });
      }
    }
    parsed.set(voice, bars);
  }

  // Time signature of every bar (a [time:] on any part applies to all).
  const nBars = Math.max(0, ...[...parsed.values()].map((b) => b.length));
  const times: TimeSig[] = [];
  let t = header.time;
  for (let b = 0; b < nBars; b++) {
    for (const bars of parsed.values()) {
      for (const d of bars[b]?.pulses.flat().flatMap((it) => it.directives) ?? []) {
        if (d.type === 'time') t = d.time;
      }
    }
    times.push(t);
  }
  const pulseLen = (b: number) => frac(1, times[b].beatType);
  const offsetOf = (b: number, pulse: number, pos: Frac) => mul(pulseLen(b), add(frac(pulse), pos));

  // Keys at every point (a [key:] on any part applies to all).
  const keys = new KeyMap(header.key);
  for (const bars of parsed.values()) {
    bars.forEach((bar, b) => bar.pulses.forEach((items, p) => items.forEach((it) => {
      for (const d of it.directives) if (d.type === 'key') keys.add(b, offsetOf(b, p, it.pos), d.key);
    })));
  }
  const dohOctave = (k: Key) => header.dohOctave ?? defaultDohOctave(k);

  // Pass 2: items → note events with pitches and lengths.
  const raw: RawPart[] = [];
  for (const [voice, bars] of parsed) {
    const rawBars: RawBar[] = [];
    let prevBarLast: NoteEvent | undefined;
    bars.forEach((bar, b) => {
      const where = `${VOICE_NAMES[voice]}, bar ${b + 1}`;
      for (const e of bar.errors) flags.push({ level: 'error', code: 'unreadable', part: voice, measure: b, message: `${where}: ${e}` });
      const rb: RawBar = {
        events: [], directives: [],
        repeatStart: bar.shell.repeatStart, repeatEnd: bar.shell.repeatEnd,
        doubleBar: bar.shell.doubleBar, finalBar: bar.shell.finalBar,
        unreadable: bar.errors.length > 0,
      };
      if (bar.wholeRest) {
        rb.events.push(newEvent('rest', [], barLength(times[b])));
        rawBars.push(rb);
        prevBarLast = rb.events[0];
        return;
      }
      const starts: Frac[] = [];
      const pulseOf: number[] = [];
      let last: NoteEvent | undefined;
      let lastIsTriplet = false;
      bar.pulses.forEach((items, p) => {
        const tripletPulse = items.some((x) => x.pos.d === 3);
        for (const it of items) {
          const offset = offsetOf(b, p, it.pos);
          for (const d of it.directives) rb.directives.push({ offset, d });
          const push = (ev: NoteEvent) => {
            rb.events.push(ev);
            starts.push(offset);
            pulseOf.push(p);
            last = ev;
            lastIsTriplet = tripletPulse;
          };
          if (it.kind === 'skip') continue;
          if (it.kind === 'rest') {
            const ev = newEvent('rest', [], ZERO);
            applyMarks(ev, it.marks);
            push(ev);
          } else if (it.kind === 'note') {
            const key = keys.at(b, offset);
            const pitch = solfaToPitch(it.syllable!, it.octave ?? 0, key, dohOctave(key), voice);
            const extra = (it.chord ?? []).map((c) => solfaToPitch(c.syllable, c.octave, key, dohOctave(key), voice));
            const all = [pitch, ...extra];
            const ev = newEvent('note', all.every(Boolean) ? (all as Pitch[]) : [], ZERO);
            if (it.bridge) {
              ev.bridgeFrom = it.bridge;
              const oldKey = keys.before(b, offset);
              const oldPitch = solfaToPitch(it.bridge, 0, oldKey, dohOctave(oldKey), voice);
              if (sameKey(oldKey, key)) {
                flags.push({ level: 'warning', code: 'bridge', part: voice, measure: b, message: `${where}: bridge note "${it.bridge}/${it.syllable}" but no [key:] change at that point.` });
              } else if (pitch && oldPitch && pitchClassSemitone(oldPitch) !== pitchClassSemitone(pitch)) {
                flags.push({ level: 'warning', code: 'bridge', part: voice, measure: b, message: `${where}: bridge note "${it.bridge}/${it.syllable}" does not match: "${it.bridge}" in the old key is not the same note as "${it.syllable}" in the new key.` });
              }
            }
            applyMarks(ev, it.marks);
            push(ev);
          } else {
            // Hold "-": keep the current note going.
            const crossesTriplet = lastIsTriplet && it.pos.n === 0;
            if (last && !crossesTriplet) {
              applyMarks(last, it.marks);
              continue;
            }
            const before = last ?? prevBarLast;
            if (!before) {
              flags.push({ level: 'error', code: 'hold', part: voice, measure: b, message: `${where}: "-" (hold) with no note before it.` });
              push(newEvent('rest', [], ZERO));
              continue;
            }
            // A hold at the start of a bar (or after a triplet) = a tied note.
            const ev = newEvent(before.kind, before.pitches.map((x) => ({ ...x })), ZERO);
            if (before.kind === 'note') before.tieToNext = true;
            applyMarks(ev, it.marks);
            push(ev);
          }
        }
      });
      // Lengths: each event lasts until the next one starts (or the bar ends).
      const end = mul(pulseLen(b), frac(bar.pulses.length));
      rb.events.forEach((ev, k) => {
        ev.duration = sub(k + 1 < starts.length ? starts[k + 1] : end, starts[k]);
        // Thirds of a pulse = triplets.
        const pStart = mul(pulseLen(b), frac(pulseOf[k]));
        const relStart = div(sub(starts[k], pStart), pulseLen(b));
        const relEnd = div(sub(add(starts[k], ev.duration), pStart), pulseLen(b));
        if (relStart.d === 3 || relEnd.d === 3) {
          if (relEnd.n <= relEnd.d) ev.tuplet = { actual: 3, normal: 2, group: `${voice}-${b}-${pulseOf[k]}` };
          else flags.push({ level: 'warning', code: 'tuplet', part: voice, measure: b, message: `${where}: a triplet note is held past the end of its pulse; this cannot be written exactly in staff notation.` });
        }
      });
      if (rb.events.some((e) => e.kind === 'note' && e.pitches.length === 0)) rb.unreadable = true;
      prevBarLast = rb.events[rb.events.length - 1] ?? prevBarLast;
      rawBars.push(rb);
    });
    raw.push({ voice, bars: rawBars, lyrics: lyricLines.get(voice) ?? new Map() });
  }

  const score = buildScore(header, raw, flags, 'typed sol-fa');
  // Sanity check for impossible pitches (e.g. far too many octave marks).
  for (const part of score.parts) {
    for (const m of part.measures) for (const ev of m.events) {
      for (const p of ev.pitches) if (midi(p) < 21 || midi(p) > 108) {
        flags.push({ level: 'error', code: 'pitch', part: part.id, noteId: ev.id, message: `${part.name}: a note is outside the piano range — check the octave marks.` });
      }
    }
  }
  return score;
}

function newEvent(kind: NoteEvent['kind'], pitches: NoteEvent['pitches'], duration: Frac): NoteEvent {
  return { id: '', kind, pitches, duration, confidence: 1 };
}
