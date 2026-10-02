// Automatic checks run after every reading of a score. They never change the
// score — they only report problems (flags) for you to look at and decide.

import { add, div, eq, frac, gt, lt, toNumber, type Frac } from '../model/fraction';
import type { Flag, MeasureInfo, Score } from '../model/types';
import { eventStarts, keyAt, tiedIntoBar } from '../model/score';
import { keyAlter, midi, pitchName, VOICE_RANGES } from '../convert/pitch';
import { barLength, eventsLength } from '../textinput/common';

/** Confidence below this is marked as "uncertain" in the review screen. */
export const LOW_CONFIDENCE = 0.8;

export function analyzeScore(score: Score): Flag[] {
  return [
    ...checkBarCounts(score),
    ...checkBarLengths(score),
    ...checkRanges(score),
    ...checkAccidentals(score),
    ...checkTies(score),
    ...checkRepeats(score.measures),
    ...checkConfidence(score),
    ...checkSlurs(score),
  ];
}

/** Length in beats, as words: "3 beats", "2½ beats". */
function beatsText(len: Frac, m: MeasureInfo): string {
  const beats = toNumber(div(len, frac(1, m.time.beatType)));
  const whole = Math.floor(beats);
  const fracPart = beats - whole;
  const nice: Record<string, string> = { '0.5': '½', '0.25': '¼', '0.75': '¾' };
  const f = nice[String(Math.round(fracPart * 100) / 100)];
  const n = fracPart === 0 ? `${whole}` : f ? `${whole || ''}${f}` : beats.toFixed(2);
  return `${n} beat${beats === 1 ? '' : 's'}`;
}

export function checkBarCounts(score: Score): Flag[] {
  const counts = score.parts.map((p) => p.measures.length);
  if (new Set(counts).size <= 1) return [];
  const detail = score.parts.map((p) => `${p.name} ${p.measures.length}`).join(', ');
  return [{ level: 'error', code: 'bar-count', message: `The parts have different numbers of bars (${detail}). They should all match.` }];
}

export function checkBarLengths(score: Score): Flag[] {
  const flags: Flag[] = [];
  const ms = score.measures;
  for (const part of score.parts) {
    part.measures.forEach((pm, b) => {
      const m = ms[b];
      if (!m) return;
      const want = barLength(m.time);
      const got = eventsLength(pm.events);
      if (eq(got, want)) return;
      const isLast = b === ms.length - 1;
      if (m.pickup && b === 0 && lt(got, want)) return; // pickup bar: short on purpose
      if (isLast && ms[0]?.pickup && lt(got, want)) {
        const pickupLen = eventsLength(score.parts[0].measures[0]?.events ?? []);
        if (eq(add(got, pickupLen), want)) {
          flags.push({ level: 'info', code: 'bar-length', part: part.id, measure: b, message: `${part.name}, last bar: short, and together with the pickup bar it makes a full bar. That is normal.` });
          return;
        }
      }
      const what = gt(got, want) ? 'too long' : 'too short';
      flags.push({
        level: 'error', code: 'bar-length', part: part.id, measure: b,
        message: `${part.name}, bar ${m.number}: ${what} — it has ${beatsText(got, m)} but ${m.time.beats}/${m.time.beatType} needs ${beatsText(want, m)}.`,
      });
    });
  }
  return flags;
}

export function checkRanges(score: Score): Flag[] {
  const flags: Flag[] = [];
  for (const part of score.parts) {
    const range = VOICE_RANGES[part.id];
    part.measures.forEach((pm, b) => {
      const out = pm.events.flatMap((e) => e.pitches.filter((p) => midi(p) < range.low || midi(p) > range.high).map((p) => ({ e, p })));
      if (!out.length) return;
      const names = [...new Set(out.map((x) => pitchName(x.p)))].join(', ');
      const high = out.some((x) => midi(x.p) > range.high);
      flags.push({
        level: 'warning', code: 'range', part: part.id, measure: b, noteId: out[0].e.id,
        message: `${part.name}, bar ${score.measures[b]?.number ?? b + 1}: ${names} is ${high ? 'above' : 'below'} the usual ${part.name.toLowerCase()} range (${range.text}). Check the octave.`,
      });
    });
  }
  return flags;
}

/**
 * Accidental logic: lists notes that are not in the key (so you can check
 * them against the page), and warns more strongly when such a note was read
 * with low confidence — the most common photo-reading mistake.
 */
export function checkAccidentals(score: Score): Flag[] {
  const flags: Flag[] = [];
  for (const part of score.parts) {
    part.measures.forEach((pm, b) => {
      const m = score.measures[b];
      if (!m) return;
      const starts = eventStarts(pm.events);
      const chromatic: string[] = [];
      pm.events.forEach((ev, k) => {
        const key = keyAt(m, starts[k]);
        for (const p of ev.pitches) {
          if (p.alter === keyAlter(p.step, key)) continue;
          chromatic.push(pitchName(p));
          if ((ev.confidence ?? 1) < LOW_CONFIDENCE) {
            flags.push({ level: 'warning', code: 'accidental', part: part.id, measure: b, noteId: ev.id, message: `${part.name}, bar ${m.number}: ${pitchName(p)} is not in the key and was read with low confidence. Check the accidental.` });
          }
          if (Math.abs(p.alter) === 2) {
            flags.push({ level: 'info', code: 'accidental', part: part.id, measure: b, noteId: ev.id, message: `${part.name}, bar ${m.number}: double ${p.alter > 0 ? 'sharp' : 'flat'} on ${pitchName(p)}. Rare — please confirm.` });
          }
        }
      });
      if (chromatic.length) {
        flags.push({ level: 'info', code: 'chromatic', part: part.id, measure: b, message: `${part.name}, bar ${m.number}: notes outside the key: ${[...new Set(chromatic)].join(', ')}.` });
      }
    });
  }
  return flags;
}

export function checkTies(score: Score): Flag[] {
  const flags: Flag[] = [];
  const same = (a: { pitches: { step: string; alter: number; octave: number }[] }, b: typeof a) =>
    a.pitches.map((p) => `${p.step}${p.alter}${p.octave}`).sort().join() === b.pitches.map((p) => `${p.step}${p.alter}${p.octave}`).sort().join();
  for (const part of score.parts) {
    part.measures.forEach((pm, b) => {
      const real = pm.events.filter((e) => !e.grace);
      const from = tiedIntoBar(part, b);
      if (from && real[0] && (real[0].kind !== 'note' || !same(from, real[0]))) {
        flags.push({ level: 'warning', code: 'tie', part: part.id, measure: b, message: `${part.name}, bar ${score.measures[b]?.number}: the tie from the previous bar does not lead to the same note.` });
      }
      real.forEach((ev, k) => {
        const next = real[k + 1];
        if (ev.tieToNext && next && (next.kind !== 'note' || !same(ev, next))) {
          flags.push({ level: 'warning', code: 'tie', part: part.id, measure: b, noteId: ev.id, message: `${part.name}, bar ${score.measures[b]?.number}: a tie joins two different notes.` });
        }
      });
      if (b === part.measures.length - 1 && real.length && real[real.length - 1].tieToNext) {
        flags.push({ level: 'warning', code: 'tie', part: part.id, measure: b, message: `${part.name}: the last note has a tie to nothing.` });
      }
    });
  }
  return flags;
}

export function checkRepeats(ms: MeasureInfo[]): Flag[] {
  const flags: Flag[] = [];
  const warn = (measure: number | undefined, message: string) => flags.push({ level: 'warning', code: 'repeat', measure, message });
  const n = (i: number) => ms[i]?.number ?? i + 1;

  // Repeat signs: every start should have an end after it.
  let open: number | undefined;
  ms.forEach((m, i) => {
    if (m.repeatStart) {
      if (open !== undefined) warn(i, `Bar ${n(i)}: a new start-repeat sign before the one at bar ${n(open)} was closed.`);
      open = i;
    }
    if (m.repeatEnd) open = undefined;
  });
  if (open !== undefined) warn(open, `Bar ${n(open)}: start-repeat sign with no end-repeat sign after it.`);

  // Endings: numbers should run 1, 2, … in each group, and the first should end with a repeat.
  let expected = 1;
  ms.forEach((m, i) => {
    if (!m.ending?.start) return;
    const first = m.ending.numbers[0];
    if (first === 1) expected = 1;
    if (first !== expected) warn(i, `Bar ${n(i)}: ending ${m.ending.numbers.join(',')} — expected ending ${expected}.`);
    expected = m.ending.numbers[m.ending.numbers.length - 1] + 1;
    let e = i;
    while (ms[e] && !ms[e].ending?.end) e++;
    const isLastOfGroup = !ms[e + 1]?.ending?.start;
    if (!isLastOfGroup && !ms[e]?.repeatEnd) warn(i, `Bar ${n(i)}: ending ${m.ending.numbers.join(',')} should finish with an end-repeat sign.`);
  });

  // D.C. / D.S. / Coda / Fine.
  const segnos = ms.filter((m) => m.segno).length;
  const codas = ms.filter((m) => m.coda).length;
  const toCodas = ms.filter((m) => m.toCoda).length;
  const fines = ms.filter((m) => m.fine).length;
  const jumps = ms.filter((m) => m.jump);
  if (segnos > 1) warn(undefined, 'More than one Segno sign.');
  if (codas > 1) warn(undefined, 'More than one Coda sign.');
  for (const m of jumps) {
    const j = m.jump!;
    if (j.startsWith('D.S.') && !segnos) warn(m.index, `Bar ${m.number}: "${j}" but there is no Segno sign.`);
    if (j.endsWith('al Coda') && !codas) warn(m.index, `Bar ${m.number}: "${j}" but there is no Coda sign.`);
    if (j.endsWith('al Coda') && !toCodas) warn(m.index, `Bar ${m.number}: "${j}" but there is no "To Coda" sign.`);
    if (j.endsWith('al Fine') && !fines) warn(m.index, `Bar ${m.number}: "${j}" but there is no Fine.`);
  }
  if (jumps.length > 1) warn(undefined, 'More than one D.C./D.S. instruction; only the first one will be followed.');
  if (fines && !jumps.some((m) => m.jump!.endsWith('al Fine'))) warn(undefined, 'There is a Fine but no "D.C. al Fine" or "D.S. al Fine".');
  if (toCodas && !jumps.some((m) => m.jump!.endsWith('al Coda'))) warn(undefined, 'There is a "To Coda" sign but no "D.C./D.S. al Coda".');
  return flags;
}

export function checkConfidence(score: Score): Flag[] {
  const flags: Flag[] = [];
  for (const part of score.parts) {
    part.measures.forEach((pm, b) => {
      for (const ev of pm.events) {
        if ((ev.confidence ?? 1) < LOW_CONFIDENCE) {
          flags.push({ level: 'warning', code: 'low-confidence', part: part.id, measure: b, noteId: ev.id, message: `${part.name}, bar ${score.measures[b]?.number}: uncertain ${ev.kind} (confidence ${Math.round((ev.confidence ?? 1) * 100)}%). Please check it against the page.` });
        }
      }
    });
  }
  return flags;
}

export function checkSlurs(score: Score): Flag[] {
  const flags: Flag[] = [];
  for (const part of score.parts) {
    let open = 0;
    for (const pm of part.measures) for (const ev of pm.events) {
      if (ev.slurStart) open++;
      if (ev.slurEnd) open--;
      if (open < 0) {
        flags.push({ level: 'info', code: 'slur', part: part.id, message: `${part.name}: a slur ends that never started.` });
        open = 0;
      }
    }
    if (open > 0) flags.push({ level: 'info', code: 'slur', part: part.id, message: `${part.name}: a slur starts but never ends.` });
  }
  return flags;
}
