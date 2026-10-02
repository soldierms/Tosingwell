// Score → staff text (the typed staff format read by parse.ts).
// Accidentals are written only where a printed page would show them.

import { eq, frac, mul, type Frac } from '../model/fraction';
import type { Flag, NoteEvent, Pitch, Score } from '../model/types';
import { eventStarts, keyAt, tiedIntoBar } from '../model/score';
import { notate, VALUE_LETTER, type Notated } from '../convert/duration';
import { accidentalShower } from '../convert/accidentals';
import { barLength } from '../textinput/common';
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

const ACC_TEXT: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };
const BARS_PER_LINE = 4;

const lengthText = (n: Notated) => VALUE_LETTER[n.base] + '.'.repeat(n.dots);
const pitchText = (p: Pitch, acc: number | undefined) => p.step + (acc === undefined ? '' : ACC_TEXT[acc]) + p.octave;

export function writeStaffText(score: Score): { text: string; flags: Flag[] } {
  const flags: Flag[] = [];
  const out: string[] = [headerText(score), ''];

  for (const part of score.parts) {
    const barTexts: string[] = [];
    part.measures.forEach((pm, b) => {
      const m = score.measures[b];
      const toks: string[] = [...startDirectives(m, b === 0)];
      const starts = eventStarts(pm.events);
      const show = accidentalShower();
      let prevNote: NoteEvent | undefined = tiedIntoBar(part, b);
      let openTuplet: string | undefined;
      const usedPoints: Frac[] = [];

      // Whole-bar rest.
      if (pm.events.length === 1 && pm.events[0].kind === 'rest' && eq(pm.events[0].duration, barLength(m.time)) && !marksText(pm.events[0])) {
        barTexts.push([...toks, 'R', ...endDirectives(m, score.measures[b + 1])].join(' '));
        return;
      }

      pm.events.forEach((ev, k) => {
        const at = starts[k];
        if (!usedPoints.some((u) => eq(u, at))) {
          toks.push(...pointDirectives(m, at, b === 0));
          usedPoints.push(at);
        }
        if (openTuplet && ev.tuplet?.group !== openTuplet) { toks.push(')'); openTuplet = undefined; }
        if (ev.tuplet && ev.tuplet.group !== openTuplet) {
          toks.push(ev.tuplet.actual === 3 && ev.tuplet.normal === 2 ? '(3' : `(${ev.tuplet.actual}:${ev.tuplet.normal}`);
          openTuplet = ev.tuplet.group;
        }
        const written = ev.tuplet ? mul(ev.duration, frac(ev.tuplet.actual, ev.tuplet.normal)) : ev.duration;
        const pieces = notate(written);
        if (!pieces) {
          flags.push({ level: 'warning', code: 'notation', part: part.id, measure: b, noteId: ev.id, message: `${part.name}, bar ${m.number}: a note length could not be written in staff notation.` });
          return;
        }
        const key = keyAt(m, at);
        pieces.forEach((piece, i) => {
          const tiedFrom = i > 0 ? ev.pitches : prevNote?.tieToNext ? prevNote.pitches : undefined;
          const lastPiece = i === pieces.length - 1;
          const tie = ev.kind === 'note' && (!lastPiece || ev.tieToNext) ? '~' : '';
          let tok: string;
          if (ev.kind === 'rest') tok = 'r' + lengthText(piece);
          else {
            const accs = show({ pitches: ev.pitches, key, tiedFrom });
            const names = ev.pitches.map((p, j) => pitchText(p, accs[j]));
            tok = (ev.grace ? 'g' : '') + (names.length === 1 ? names[0] : `<${names.join(' ')}>`) + lengthText(piece) + tie;
          }
          if (i === 0) tok += marksText(ev);
          toks.push(tok);
        });
        if (!ev.grace) prevNote = ev.kind === 'note' ? ev : undefined;
      });
      if (openTuplet) toks.push(')');
      toks.push(...endDirectives(m, score.measures[b + 1]));
      barTexts.push(toks.join(' '));
    });

    for (let i = 0; i < barTexts.length; i += BARS_PER_LINE) {
      let line = `${part.id}: ${i === 0 ? openingBarline(score.measures[0]) : '|'}`;
      for (let b = i; b < Math.min(i + BARS_PER_LINE, barTexts.length); b++) {
        line += ` ${barTexts[b]} ${barlineBetween(score.measures[b], score.measures[b + 1])}`;
      }
      out.push(line);
    }
    out.push(...lyricLines(part));
  }
  return { text: out.join('\n') + '\n', flags };
}
