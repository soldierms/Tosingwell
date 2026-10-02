// Small helpers for reading a Score.

import { add, lte, ZERO, type Frac } from './fraction';
import type { Key, MeasureInfo, NoteEvent, Part } from './types';

/** Key in force at a point inside a bar. */
export function keyAt(m: MeasureInfo, offset: Frac): Key {
  let k = m.key;
  for (const c of m.keyChanges ?? []) if (lte(c.offset, offset)) k = c.key;
  return k;
}

/** Start offset of each event in a bar (grace notes start where the next note starts). */
export function eventStarts(events: NoteEvent[]): Frac[] {
  const out: Frac[] = [];
  let o = ZERO;
  for (const e of events) {
    out.push(o);
    if (!e.grace) o = add(o, e.duration);
  }
  return out;
}

/**
 * For each bar of a part, the note that ties INTO the bar's first note
 * (the last real note of the previous bar, if it has tieToNext).
 */
export function tiedIntoBar(part: Part, barIndex: number): NoteEvent | undefined {
  for (let b = barIndex - 1; b >= 0; b--) {
    const evs = part.measures[b]?.events.filter((e) => !e.grace) ?? [];
    if (evs.length) {
      const last = evs[evs.length - 1];
      return last.kind === 'note' && last.tieToNext ? last : undefined;
    }
  }
  return undefined;
}

/** Every event of a part, with its bar index. */
export function* partEvents(part: Part): Generator<{ ev: NoteEvent; bar: number; index: number }> {
  for (let bar = 0; bar < part.measures.length; bar++) {
    const evs = part.measures[bar].events;
    for (let index = 0; index < evs.length; index++) yield { ev: evs[index], bar, index };
  }
}
