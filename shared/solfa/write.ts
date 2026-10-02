// Score → Tonic Sol-fa.
//
// Produces both plain text (the same format parse.ts reads) and a structured
// version (bars → pulses → pieces) that the sol-fa display draws from.

import { add, div, eq, frac, gt, lt, mul, sub, toNumber, type Frac } from '../model/fraction';
import type { Flag, Key, Pitch, Score, VoiceId } from '../model/types';
import { eventStarts, keyAt, tiedIntoBar } from '../model/score';
import { defaultDohOctave, octaveMarks, pitchToSolfa } from '../convert/pitch';
import {
  barlineBetween,
  endDirectives,
  headerText,
  lyricLines,
  marksText,
  openingBarline,
  pointDirectives,
  startDirectives,
} from '../textinput/write';

/** One piece of a pulse: a note, a hold "-", a rest, a divider, or an instruction. */
export interface SolfaPiece {
  kind: 'note' | 'hold' | 'rest' | 'sep' | 'dir';
  text: string;
  /** For notes: the event this came from (used for lyrics and highlighting). */
  eventId?: string;
  /** Bridge note: old-key syllable, shown small before the new one. */
  bridge?: string;
}

export interface SolfaPulse {
  pieces: SolfaPiece[];
}

export interface SolfaBar {
  index: number;
  before: string[]; // instructions at the start of the bar
  pulses: SolfaPulse[];
  after: string[]; // instructions at the end of the bar
}

export interface SolfaPart {
  voice: VoiceId;
  bars: SolfaBar[];
}

const BARS_PER_LINE = 4;

const dohOctaveFor = (score: Score, key: Key) => score.dohOctave ?? defaultDohOctave(key);

/** Text for one pitch, e.g. "s," or "d'". */
function syllableText(p: Pitch, key: Key, score: Score, voice: VoiceId, onRespell: () => void): string {
  const s = pitchToSolfa(p, key, dohOctaveFor(score, key), voice);
  if (s.respelled) onRespell();
  return s.syllable + octaveMarks(s.octave);
}

export function writeSolfaParts(score: Score): { parts: SolfaPart[]; flags: Flag[] } {
  const flags: Flag[] = [];
  const parts: SolfaPart[] = score.parts.map((part) => {
    let graceWarned = false;
    const bars: SolfaBar[] = part.measures.map((pm, b) => {
      const m = score.measures[b];
      const where = `${part.name}, bar ${m.number}`;
      const P = frac(1, m.time.beatType);
      const real = pm.events.map((ev, k) => ({ ev, start: eventStarts(pm.events)[k] })).filter((x) => !x.ev.grace);
      if (!graceWarned && pm.events.some((e) => e.grace)) {
        graceWarned = true;
        flags.push({ level: 'info', code: 'solfa-grace', part: part.id, measure: b, message: `${where}: grace notes are not shown in sol-fa (they are still played).` });
      }
      const total = real.length ? add(real[real.length - 1].start, real[real.length - 1].ev.duration) : frac(0);
      const nPulses = Math.max(1, Math.ceil(toNumber(div(total, P)) - 1e-9));
      const tiedIn = tiedIntoBar(part, b);
      const isContinuation = (k: number) =>
        k === 0 ? !!tiedIn && real[0].ev.kind === 'note' : real[k - 1].ev.kind === 'note' && !!real[k - 1].ev.tieToNext;

      const usedPoints: Frac[] = [];
      const pulses: SolfaPulse[] = [];
      for (let j = 0; j < nPulses; j++) {
        const ps = mul(P, frac(j));
        const pe = add(ps, P);
        // Slots: position in pulse (0..1) → piece.
        const slots: { pos: Frac; piece: SolfaPiece; dirs: string[] }[] = [];
        const coverK = real.findIndex((x) => !gt(x.start, ps) && lt(ps, add(x.start, x.ev.duration)));
        for (let k = 0; k < real.length; k++) {
          const { ev, start } = real[k];
          const startsHere = !lt(start, ps) && lt(start, pe);
          const coversStart = k === coverK && lt(start, ps);
          if (!startsHere && !coversStart) continue;
          const pos = startsHere ? div(sub(start, ps), P) : frac(0);
          let piece: SolfaPiece;
          if (coversStart) piece = ev.kind === 'rest' ? { kind: 'rest', text: '' } : { kind: 'hold', text: '-' };
          else if (ev.kind === 'rest') piece = { kind: 'rest', text: '' };
          else if (isContinuation(k)) piece = { kind: 'hold', text: '-' };
          else {
            const key = keyAt(m, start);
            const respell = () => flags.push({ level: 'info', code: 'solfa-respell', part: part.id, measure: b, noteId: ev.id, message: `${where}: a note has no exact sol-fa name and was written as the same-sounding syllable.` });
            const text = ev.pitches.map((p) => syllableText(p, key, score, part.id, respell)).join('+');
            piece = { kind: 'note', text, eventId: ev.id };
            // Key change at this note → bridge note "old/new".
            const kc = m.keyChanges?.find((c) => eq(c.offset, start) && !(b === 0 && c.offset.n === 0));
            if (kc && ev.pitches[0]) {
              const before = start.n === 0 ? keyAtEnd(score.measures[b - 1]) : keyBefore(m, start);
              piece.bridge = pitchToSolfa(ev.pitches[0], before, dohOctaveFor(score, before), part.id).syllable;
            }
          }
          piece.text += startsHere ? marksText(ev) : '';
          const dirs: string[] = [];
          if (startsHere && !usedPoints.some((u) => eq(u, start))) {
            dirs.push(...pointDirectives(m, start, b === 0));
            usedPoints.push(start);
          }
          slots.push({ pos, piece, dirs });
        }
        if (!slots.length) slots.push({ pos: frac(0), piece: { kind: 'rest', text: '' }, dirs: [] });
        pulses.push({ pieces: layoutPulse(slots, () => flags.push({ level: 'warning', code: 'solfa-rhythm', part: part.id, measure: b, message: `${where}: a rhythm is too fine to write exactly in sol-fa; it was rounded to the nearest quarter-pulse.` })) });
      }
      return { index: b, before: startDirectives(m, b === 0), pulses, after: endDirectives(m, score.measures[b + 1]) };
    });
    return { voice: part.id, bars };
  });
  return { parts, flags };
}

/** Key in force at the end of bar m. */
const keyAtEnd = (m: Score['measures'][number]): Key => m.keyChanges?.[m.keyChanges.length - 1]?.key ?? m.key;

/** Key in force just before `offset` in bar m. */
function keyBefore(m: Score['measures'][number], offset: Frac): Key {
  let k = m.key;
  for (const c of m.keyChanges ?? []) if (lt(c.offset, offset)) k = c.key;
  return k;
}

const QUARTERS = [frac(0), frac(1, 4), frac(1, 2), frac(3, 4)];
const THIRDS = [frac(0), frac(1, 3), frac(2, 3)];

/** Arrange the notes of one pulse with "." and "," dividers. */
function layoutPulse(slots: { pos: Frac; piece: SolfaPiece; dirs: string[] }[], onRound: () => void): SolfaPiece[] {
  const onGrid = (grid: Frac[]) => slots.every((s) => grid.some((g) => eq(g, s.pos)));
  let grid: Frac[];
  if (onGrid(QUARTERS)) grid = QUARTERS;
  else if (onGrid(THIRDS)) grid = THIRDS;
  else {
    onRound();
    grid = QUARTERS;
    for (const s of slots) s.pos = QUARTERS.reduce((best, g) => (Math.abs(toNumber(sub(g, s.pos))) < Math.abs(toNumber(sub(best, s.pos))) ? g : best));
  }
  const at = (g: Frac) => slots.find((s) => eq(s.pos, g));
  const out: SolfaPiece[] = [];
  const put = (s: { piece: SolfaPiece; dirs: string[] } | undefined, middle: boolean) => {
    if (!s) return;
    for (const d of s.dirs) out.push({ kind: 'dir', text: d });
    // A rest in the middle of a pulse is written as a space (an empty gap would mean "keep holding").
    out.push(middle && s.piece.kind === 'rest' && !s.piece.text ? { ...s.piece, text: ' ' } : s.piece);
  };
  const sep = (t: string) => out.push({ kind: 'sep', text: t });

  put(at(grid[0]), false);
  if (grid === THIRDS) {
    sep('.');
    put(at(THIRDS[1]), true);
    sep('.');
    put(at(THIRDS[2]) ?? { piece: { kind: 'hold', text: '-' }, dirs: [] }, false);
  } else {
    const q1 = at(QUARTERS[1]), half = at(QUARTERS[2]), q3 = at(QUARTERS[3]);
    if (q1) { sep(','); put(q1, !!(half || q3)); }
    if (half) { sep('.'); put(half, !!q3); }
    if (q3) { sep(half ? ',' : '.,'); put(q3, false); }
  }
  // A low note (ending in ",") followed by a "," divider and then NOT a note would be
  // misread as an extra octave mark; use the subscript form for that note.
  for (let i = 0; i + 2 < out.length; i++) {
    const a = out[i], s = out[i + 1], nxt = out[i + 2];
    if (a.kind === 'note' && /,$/.test(a.text.replace(/\{.*\}$/, '')) && s.kind === 'sep' && s.text.startsWith(',') && !/^[drmfslt-]/.test(nxt.text)) {
      a.text = a.text.replace(/(,+)(\{.*\})?$/, (_m, commas: string, marks = '') => '₁₂₃'[commas.length - 1] + marks);
    }
  }
  return out;
}

/** The plain text of one pulse. */
export const pulseText = (p: SolfaPulse) =>
  p.pieces.map((x) => (x.kind === 'note' && x.bridge ? `${x.bridge}/${x.text}` : x.text)).join('');

export function writeSolfa(score: Score): { text: string; parts: SolfaPart[]; flags: Flag[] } {
  const { parts, flags } = writeSolfaParts(score);
  const out: string[] = [headerText(score), ''];
  for (const sp of parts) {
    const part = score.parts.find((p) => p.id === sp.voice)!;
    const barTexts = sp.bars.map((bar) => {
      const pulses = bar.pulses.map(pulseText);
      const body = pulses.map((t, i) => (i === 0 ? t : ':' + t)).join(' ');
      return [...bar.before, body, ...bar.after].filter((x) => x !== '').join(' ');
    });
    for (let i = 0; i < barTexts.length; i += BARS_PER_LINE) {
      let line = `${sp.voice}: ${i === 0 ? openingBarline(score.measures[0]) : '|'}`;
      for (let b = i; b < Math.min(i + BARS_PER_LINE, barTexts.length); b++) {
        line += ` ${barTexts[b]} ${barlineBetween(score.measures[b], score.measures[b + 1])}`;
      }
      out.push(line);
    }
    out.push(...lyricLines(part));
  }
  return { text: out.join('\n') + '\n', parts, flags };
}
