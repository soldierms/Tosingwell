// Shared helpers for WRITING the typed formats (sol-fa text and staff text)
// from a Score: header, [instructions], {marks} and lyric lines.

import { eq, type Frac } from '../model/fraction';
import type { Key, MeasureInfo, NoteEvent, Part, Score, Tempo } from '../model/types';
import { lahOf, pitchClassName } from '../convert/pitch';
import { singleNotation, VALUE_LETTER } from '../convert/duration';
import { lyricTargets } from './common';

export function keyText(key: Key): string {
  return key.mode === 'minor' ? `${pitchClassName(lahOf(key.doh))} minor` : pitchClassName(key.doh);
}

export function tempoText(t: Tempo): string {
  const parts: string[] = [];
  if (t.text) parts.push(t.text);
  if (t.bpm) {
    const unit = t.beatUnit ? singleNotation(t.beatUnit) : undefined;
    const letter = unit ? VALUE_LETTER[unit.base] + '.'.repeat(unit.dots) : 'q';
    parts.push(`${letter}=${t.bpm}`);
  }
  return parts.join(' ');
}

export function headerText(score: Score): string {
  const m0 = score.measures[0];
  const lines = [`Title: ${score.meta.title}`];
  if (score.meta.composer) lines.push(`Composer: ${score.meta.composer}`);
  if (score.meta.arranger) lines.push(`Arranger: ${score.meta.arranger}`);
  if (m0) {
    const startKey = m0.keyChanges?.find((k) => k.offset.n === 0) ? undefined : m0.key;
    // If bar 1 itself changes key at the bar line, the header key is that new key.
    const key = startKey ?? m0.keyChanges![0].key;
    let line = `Key: ${keyText(key)}   Time: ${m0.time.beats}/${m0.time.beatType}`;
    if (m0.tempo) line += `   Tempo: ${tempoText(m0.tempo)}`;
    lines.push(line);
  }
  if (score.dohOctave !== undefined && m0) lines.push(`Doh: ${pitchClassName(m0.key.doh)}${score.dohOctave}`);
  return lines.join('\n');
}

/** Instructions that belong at the START of a bar (before its first note). */
export function startDirectives(m: MeasureInfo, isFirst: boolean): string[] {
  const out: string[] = [];
  if (m.ending?.start) out.push(`[ending:${m.ending.numbers.join(',')}]`);
  if (m.segno) out.push('[segno]');
  if (m.coda) out.push('[coda]');
  if (m.timeChanged && !isFirst) out.push(`[time:${m.time.beats}/${m.time.beatType}]`);
  if (m.tempo && !isFirst) out.push(`[tempo:${tempoText(m.tempo)}]`);
  return out;
}

/** Instructions at a point inside the bar (key changes, rit., accel.). */
export function pointDirectives(m: MeasureInfo, offset: Frac, isFirstBar: boolean): string[] {
  const out: string[] = [];
  for (const kc of m.keyChanges ?? []) {
    if (eq(kc.offset, offset) && !(isFirstBar && kc.offset.n === 0)) out.push(`[key:${keyText(kc.key)}]`);
  }
  for (const tc of m.tempoChanges ?? []) if (eq(tc.offset, offset)) out.push(`[${tc.kind}]`);
  return out;
}

/** Instructions at the END of a bar. */
export function endDirectives(m: MeasureInfo, next: MeasureInfo | undefined): string[] {
  const out: string[] = [];
  if (m.toCoda) out.push('[tocoda]');
  if (m.fine) out.push('[fine]');
  if (m.jump) out.push(`[${m.jump}]`);
  // Close an ending explicitly unless the reader would end it here anyway.
  if (m.ending?.end && !m.repeatEnd && !next?.ending?.start && !m.ending.numbers.includes(1)) out.push('[/ending]');
  return out;
}

/** Offsets in the bar where something happens that the writer must place. */
export function pointOffsets(m: MeasureInfo): Frac[] {
  return [...(m.keyChanges ?? []).map((k) => k.offset), ...(m.tempoChanges ?? []).map((t) => t.offset)];
}

/** The bar line written before the first bar. */
export const openingBarline = (m: MeasureInfo) => (m.repeatStart ? '||:' : '|');

/** The bar line written between bar `m` and the bar after it (`next`, if any). */
export function barlineBetween(m: MeasureInfo, next: MeasureInfo | undefined): string {
  if (m.repeatEnd && next?.repeatStart) return ':||:';
  if (m.repeatEnd) return ':||';
  if (next?.repeatStart) return '||:';
  if (m.finalBar) return '|]';
  if (m.doubleBar) return '||';
  return '|';
}

export function marksText(ev: NoteEvent): string {
  const w: string[] = [];
  for (const a of ev.articulations ?? []) w.push({ staccato: 'stacc', accent: 'acc', tenuto: 'ten', marcato: 'marc' }[a]);
  if (ev.fermata) w.push('ferm');
  if (ev.dynamic) w.push(ev.dynamic);
  if (ev.hairpin) w.push(ev.hairpin === 'end' ? '/hp' : ev.hairpin);
  if (ev.slurStart) w.push('(');
  if (ev.slurEnd) w.push(')');
  if (ev.pedal) w.push(ev.pedal === 'down' ? 'ped' : '*');
  if (ev.confidence !== undefined && ev.confidence < 1) w.push(`conf=${Math.round(ev.confidence * 100) / 100}`);
  return w.length ? `{${w.join(',')}}` : '';
}

/** Lyric lines for a part, e.g. "S-lyrics: All peo-ple that _ on". */
export function lyricLines(part: Part): string[] {
  const targets = lyricTargets(part);
  const verses = new Set<number>();
  for (const t of targets) for (const l of t.lyrics ?? []) verses.add(l.verse);
  return [...verses].sort().map((verse) => {
    const toks: string[] = [];
    let extending = false;
    for (const t of targets) {
      const l = t.lyrics?.find((x) => x.verse === verse);
      if (l) {
        const open = l.syllabic === 'begin' || l.syllabic === 'middle';
        toks.push(l.text.replace(/ /g, '~') + (open ? '-' : ''));
        extending = !!l.extend;
      } else toks.push(extending ? '_' : '*');
    }
    while (toks.length && toks[toks.length - 1] === '*') toks.pop();
    const label = verse === 1 ? `${part.id}-lyrics` : `${part.id}-lyrics-${verse}`;
    return `${label}: ${toks.join(' ').replace(/- (?=[^_*\s])/g, '-')}`;
  });
}

