// Test helpers: load fixture files and describe a score in a simple,
// comparable form (bar by bar), so tests can say exactly where two scores differ.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { add, eq, fracToString, ZERO, type Frac } from '../shared/model/fraction';
import type { NoteEvent, Score } from '../shared/model/types';
import { pitchName } from '../shared/convert/pitch';

export const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/**
 * Notes of every bar as text, e.g. "G4@0:1/2 r@1/2:1/2".
 * Notes tied together inside a bar are joined into one (and adjacent rests
 * too), so "G4h~ G4q" and "d :- :-" compare as equal.
 */
export function barsOf(score: Score, voice: string): string[] {
  const part = score.parts.find((p) => p.id === voice);
  if (!part) return [];
  return part.measures.map((m) => {
    const merged: { ev: NoteEvent; start: Frac; dur: Frac }[] = [];
    let at = ZERO;
    let prev: NoteEvent | undefined;
    for (const ev of m.events) {
      if (ev.grace) continue;
      const last = merged[merged.length - 1];
      const joinTie = last && prev?.tieToNext && ev.kind === 'note' && samePitches(prev, ev);
      const joinRest = last && last.ev.kind === 'rest' && ev.kind === 'rest';
      if (joinTie || joinRest) last.dur = add(last.dur, ev.duration);
      else merged.push({ ev, start: at, dur: ev.duration });
      at = add(at, ev.duration);
      prev = ev;
    }
    return merged
      .map(({ ev, start, dur }) => `${ev.kind === 'rest' ? 'r' : ev.pitches.map(pitchName).join('+')}@${fracToString(start)}:${fracToString(dur)}`)
      .join(' ');
  });
}

const samePitches = (a: NoteEvent, b: NoteEvent) => a.pitches.map(pitchName).join() === b.pitches.map(pitchName).join();

/** Lyric syllables of a part in order, e.g. ["All", "peo-", "ple"]. */
export function lyricsOf(score: Score, voice: string, verse = 1): string[] {
  const part = score.parts.find((p) => p.id === voice)!;
  return part.measures.flatMap((m) =>
    m.events.flatMap((e) => e.lyrics?.filter((l) => l.verse === verse).map((l) => l.text + (l.syllabic === 'begin' || l.syllabic === 'middle' ? '-' : '') + (l.extend ? '_' : '')) ?? []),
  );
}

/** Bar-level structure as comparable text. */
export function structureOf(score: Score): string[] {
  return score.measures.map((m) => {
    const bits = [`#${m.number}`, `${m.time.beats}/${m.time.beatType}`, `${m.key.doh.step}${m.key.doh.alter}${m.key.mode}`];
    if (m.pickup) bits.push('pickup');
    if (m.repeatStart) bits.push('||:');
    if (m.repeatEnd) bits.push(':||');
    if (m.ending) bits.push(`ending${m.ending.numbers.join(',')}${m.ending.start ? '[' : ''}${m.ending.end ? ']' : ''}`);
    if (m.segno) bits.push('segno');
    if (m.coda) bits.push('coda');
    if (m.toCoda) bits.push('tocoda');
    if (m.fine) bits.push('fine');
    if (m.jump) bits.push(m.jump);
    if (m.tempo) bits.push(`tempo:${m.tempo.text ?? ''}${m.tempo.bpm ?? ''}`);
    for (const t of m.tempoChanges ?? []) bits.push(`${t.kind}@${fracToString(t.offset)}`);
    for (const k of m.keyChanges ?? []) bits.push(`key:${k.key.doh.step}${k.key.doh.alter}@${fracToString(k.offset)}`);
    return bits.join(' ');
  });
}

/** Marks on notes (dynamics, articulations, fermata) in order, for comparison. */
export function marksOf(score: Score, voice: string): string[] {
  const part = score.parts.find((p) => p.id === voice)!;
  return part.measures.flatMap((m, b) =>
    m.events.flatMap((e) => {
      const w = [e.dynamic, ...(e.articulations ?? []), e.fermata ? 'fermata' : undefined].filter(Boolean);
      return w.length ? [`bar${b}:${w.join(',')}`] : [];
    }),
  );
}

export const isZeroLength = (f: Frac) => eq(f, ZERO);
