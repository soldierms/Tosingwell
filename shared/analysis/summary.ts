// The analysis summary shown before playing: what the app understood.

import type { Flag, MeasureInfo, Score } from '../model/types';
import { keyLabel, pitchClassName } from '../convert/pitch';
import { tempoText } from '../textinput/write';

export interface ScoreSummary {
  title: string;
  composer?: string;
  key: string;
  doh: string;
  time: string;
  tempo: string;
  bars: number;
  pickup: boolean;
  parts: string[];
  changes: string[]; // key / time / tempo changes during the piece
  structure: string[]; // repeats, endings, D.C./D.S., Coda, Fine
  counts: Record<Flag['level'], number>;
}

const barNo = (m: MeasureInfo) => (m.pickup ? 'pickup bar' : `bar ${m.number}`);

export function summarize(score: Score, flags: Flag[]): ScoreSummary {
  const ms = score.measures;
  const m0 = ms[0];
  const changes: string[] = [];
  const structure: string[] = [];
  ms.forEach((m, i) => {
    if (i > 0 && m.timeChanged) changes.push(`Time changes to ${m.time.beats}/${m.time.beatType} at ${barNo(m)}`);
    for (const kc of m.keyChanges ?? []) {
      if (i === 0 && kc.offset.n === 0) continue;
      changes.push(`Key changes to ${keyLabel(kc.key)} in ${barNo(m)}`);
    }
    if (i > 0 && m.tempo) changes.push(`Tempo ${tempoText(m.tempo)} at ${barNo(m)}`);
    for (const t of m.tempoChanges ?? []) changes.push(`${t.kind === 'rit' ? 'Ritardando (slowing down)' : t.kind === 'accel' ? 'Accelerando (speeding up)' : 'A tempo (back to speed)'} in ${barNo(m)}`);
  });

  // Repeat sections.
  let start: MeasureInfo | undefined;
  ms.forEach((m) => {
    if (m.repeatStart) start = m;
    if (m.repeatEnd) {
      structure.push(`Repeat from ${start ? barNo(start) : 'the beginning'} to ${barNo(m)}`);
      start = undefined;
    }
    if (m.ending?.start) {
      let e = m.index;
      while (ms[e] && !ms[e].ending?.end) e++;
      const nums = m.ending.numbers.map((n) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`).join(' & ');
      structure.push(`${nums} ending: ${e === m.index ? barNo(m) : `bars ${m.number}–${ms[e]?.number}`}`);
    }
    if (m.segno) structure.push(`Segno sign at ${barNo(m)}`);
    if (m.toCoda) structure.push(`"To Coda" at the end of ${barNo(m)}`);
    if (m.coda) structure.push(`Coda starts at ${barNo(m)}`);
    if (m.fine) structure.push(`Fine (the end) after ${barNo(m)}`);
    if (m.jump) structure.push(`${m.jump} at the end of ${barNo(m)}`);
  });

  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of flags) counts[f.level]++;

  const realBars = ms.filter((m) => !m.pickup).length;
  return {
    title: score.meta.title,
    composer: score.meta.composer,
    key: m0 ? keyLabel(m0.key) : '—',
    doh: m0 ? pitchClassName(m0.key.doh, true) : '—',
    time: m0 ? `${m0.time.beats}/${m0.time.beatType}` : '—',
    tempo: m0?.tempo ? tempoText(m0.tempo) : 'not given (playback will use q=80)',
    bars: realBars,
    pickup: !!m0?.pickup,
    parts: score.parts.map((p) => p.name),
    changes,
    structure: structure.length ? structure : ['No repeats — played straight through'],
    counts,
  };
}
