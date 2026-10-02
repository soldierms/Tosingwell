// Works out the PLAY ORDER of bars from the written route through the score:
// repeat signs, 1st/2nd (…) endings, D.C., D.S., Segno, Coda, To Coda, Fine.
//
// Conventions used (standard practice):
//  - An end-repeat with no start-repeat goes back to the beginning.
//  - A repeat is played once (two times through) unless endings ask for more
//    (e.g. ending "1, 2" then ending "3" = three times through).
//  - After a D.C. or D.S. jump, repeats are NOT taken again and only the last
//    ending is played (can be switched off with `repeatsAfterJump`).
//  - "al Fine": stop at the Fine after the jump. "al Coda": after the jump,
//    go from the "To Coda" bar to the Coda.

import type { Flag, MeasureInfo } from '../model/types';

export interface PlayStep {
  /** Bar index (0-based) in the score. */
  measure: number;
  /** Time through the current repeat section (1, 2, …). */
  pass: number;
  /** How we arrived at this bar, if not simply the next bar. */
  via?: 'repeat' | 'ending' | 'D.C.' | 'D.S.' | 'coda';
  /** True once a D.C./D.S. jump has happened. */
  afterJump: boolean;
}

export interface ExpandOptions {
  repeatsAfterJump?: boolean;
}

const MAX_STEPS = 5000;

interface EndingGroup {
  /** [start, end] bar ranges of each ending in the group, in order. */
  endings: { start: number; end: number; numbers: number[] }[];
}

function endingGroups(ms: MeasureInfo[]): Map<number, { group: EndingGroup; index: number }> {
  const byStart = new Map<number, { group: EndingGroup; index: number }>();
  let i = 0;
  while (i < ms.length) {
    if (!ms[i].ending?.start) { i++; continue; }
    const group: EndingGroup = { endings: [] };
    let s = i;
    while (s < ms.length && ms[s].ending?.start) {
      let e = s;
      while (e < ms.length - 1 && !ms[e].ending?.end) e++;
      group.endings.push({ start: s, end: e, numbers: ms[s].ending!.numbers });
      byStart.set(s, { group, index: group.endings.length - 1 });
      s = e + 1;
    }
    i = s;
  }
  return byStart;
}

export function expandPlayOrder(ms: MeasureInfo[], opts: ExpandOptions = {}): { steps: PlayStep[]; flags: Flag[] } {
  const flags: Flag[] = [];
  const steps: PlayStep[] = [];
  if (!ms.length) return { steps, flags };
  const groups = endingGroups(ms);
  const segno = ms.findIndex((m) => m.segno);
  const coda = ms.findIndex((m) => m.coda);

  let i = 0;
  let pass = 1;
  let sectionStart = 0;
  let jumped: MeasureInfo['jump'] | undefined;
  let via: PlayStep['via'];
  const taken = new Map<number, number>(); // repeat-end bar → times the repeat was taken

  const skipRepeats = () => !!jumped && !opts.repeatsAfterJump;

  while (i < ms.length) {
    if (steps.length > MAX_STEPS) {
      flags.push({ level: 'error', code: 'play-order', message: 'The repeat signs make an endless loop; playback was stopped. Please check the repeats and D.C./D.S. signs.' });
      break;
    }
    const m = ms[i];
    if (m.repeatStart && via !== 'repeat') {
      sectionStart = i;
      pass = 1;
    }

    // Endings: skip the ones that don't belong to this time through.
    const g = groups.get(i);
    if (g) {
      const ending = g.group.endings[g.index];
      const isLast = g.index === g.group.endings.length - 1;
      const play = skipRepeats() ? isLast : ending.numbers.includes(pass) || (isLast && pass > Math.max(...g.group.endings.flatMap((e) => e.numbers)));
      if (!play) {
        i = ending.end + 1;
        via = 'ending';
        continue;
      }
    }

    steps.push({ measure: i, pass, via, afterJump: !!jumped });
    via = undefined;

    // Finished the last ending of a group: the repeat section is over.
    const inGroup = findGroupContaining(groups, i);
    if (inGroup && !m.repeatEnd) {
      const lastEnding = inGroup.group.endings[inGroup.group.endings.length - 1];
      if (i === lastEnding.end) {
        pass = 1;
        sectionStart = i + 1;
      }
    }

    // Fine / To Coda only count after the jump.
    if (jumped?.endsWith('al Fine') && m.fine) break;
    if (jumped?.endsWith('al Coda') && m.toCoda) {
      if (coda < 0) break;
      i = coda;
      via = 'coda';
      continue;
    }

    // End-repeat.
    if (m.repeatEnd && !skipRepeats()) {
      const t = taken.get(i) ?? 0;
      let again: boolean;
      if (g || m.ending) {
        // In an ending: repeat if a later time through has its own ending.
        const grp = (g ?? findGroupContaining(groups, i))?.group;
        const maxNum = grp ? Math.max(...grp.endings.flatMap((e) => e.numbers)) : 2;
        again = pass < maxNum;
      } else {
        again = t < 1;
      }
      if (again) {
        taken.set(i, t + 1);
        pass++;
        i = sectionStart;
        via = 'repeat';
        continue;
      }
      pass = 1;
      sectionStart = i + 1;
    }

    // D.C. / D.S. at the end of the bar (only once).
    if (m.jump && !jumped) {
      jumped = m.jump;
      taken.clear();
      pass = 1;
      if (m.jump.startsWith('D.S.')) {
        if (segno < 0) {
          flags.push({ level: 'warning', code: 'play-order', measure: i, message: `Bar ${m.number}: "${m.jump}" but no Segno; playback stops here.` });
          break;
        }
        i = segno;
        via = 'D.S.';
      } else {
        i = 0;
        via = 'D.C.';
      }
      sectionStart = i;
      continue;
    }
    i++;
  }
  return { steps, flags };
}

function findGroupContaining(groups: Map<number, { group: EndingGroup; index: number }>, bar: number) {
  for (const v of groups.values()) if (v.group.endings.some((e) => bar >= e.start && bar <= e.end)) return v;
  return undefined;
}

/**
 * The play order in words, e.g.
 *   "Bars 0–3", "Bars 1–2 again (repeat)", "Bar 4 (2nd ending)", "Bars 5–6", "D.C.: bars 0–6, stop at Fine"
 */
export function describePlayOrder(steps: PlayStep[], ms: MeasureInfo[]): string[] {
  const out: string[] = [];
  const label = (i: number) => (ms[i].pickup ? 'pickup' : String(ms[i].number));
  let k = 0;
  while (k < steps.length) {
    const first = steps[k];
    let last = k;
    while (last + 1 < steps.length && steps[last + 1].measure === steps[last].measure + 1 && !steps[last + 1].via) last++;
    const a = first.measure;
    const b = steps[last].measure;
    let text = a === b ? `Bar ${label(a)}` : ms[a].pickup ? `Pickup + bars ${label(a + 1)}–${label(b)}` : `Bars ${label(a)}–${label(b)}`;
    const endingBar = steps.slice(k, last + 1).find((s) => ms[s.measure].ending?.start);
    if (endingBar) {
      const n = ms[endingBar.measure].ending!.numbers.map(ordinal).join(' & ');
      text += ` (${n} ending)`;
    }
    if (first.via === 'repeat') text = `Repeat: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    if (first.via === 'D.C.' || first.via === 'D.S.') text = `${first.via} — back to ${first.via === 'D.C.' ? 'the start' : 'the Segno'}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    if (first.via === 'coda') text = `To the Coda: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    const lastM = ms[b];
    if (k === steps.length - 1 || last === steps.length - 1) {
      if (lastM.fine && first.afterJump) text += ' — stop at Fine';
    }
    out.push(text);
    k = last + 1;
  }
  return out;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
