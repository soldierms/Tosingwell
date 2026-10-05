// Small edits to one note, used by the review screen ("click a note to fix it").
// Every edit returns a NEW score (the old one is not changed) and marks the note
// as checked by you (confidence 1).

import type { Frac } from '../model/fraction';
import type { Pitch, Score, VoiceId } from '../model/types';
import { keyAt, eventStarts } from '../model/score';
import { keyAlter, STEPS } from '../convert/pitch';

export type NoteEdit =
  | { type: 'step'; delta: 1 | -1 } // move up/down one letter (to the note that's in the key)
  | { type: 'octave'; delta: 1 | -1 }
  | { type: 'accidental'; alter: -1 | 0 | 1 } // flat, natural, sharp (what it should SOUND as)
  | { type: 'length'; duration: Frac }
  | { type: 'kind'; kind: 'note' | 'rest' }
  | { type: 'tie' }
  | { type: 'confirm' }
  | { type: 'delete' };

/** A typical note for each voice, used when turning a rest into a note. */
const DEFAULT_PITCH: Record<VoiceId, Pitch> = {
  S: { step: 'C', alter: 0, octave: 5 },
  A: { step: 'G', alter: 0, octave: 4 },
  T: { step: 'C', alter: 0, octave: 4 },
  B: { step: 'C', alter: 0, octave: 3 },
};

export function findEvent(score: Score, id: string) {
  for (const part of score.parts) {
    for (let b = 0; b < part.measures.length; b++) {
      const k = part.measures[b].events.findIndex((e) => e.id === id);
      if (k >= 0) return { part, bar: b, index: k, ev: part.measures[b].events[k] };
    }
  }
  return undefined;
}

export function editNote(score: Score, id: string, edit: NoteEdit): Score {
  const copy: Score = structuredClone(score);
  const found = findEvent(copy, id);
  if (!found) return score;
  const { part, bar, index, ev } = found;
  const events = part.measures[bar].events;
  const key = keyAt(copy.measures[bar], eventStarts(events)[index]);

  const movePitch = (p: Pitch, delta: number): Pitch => {
    const i = STEPS.indexOf(p.step) + delta;
    const step = STEPS[(i + 7) % 7];
    const octave = p.octave + Math.floor(i / 7);
    return { step, octave, alter: keyAlter(step, key) };
  };

  switch (edit.type) {
    case 'step':
      ev.pitches = ev.pitches.map((p) => movePitch(p, edit.delta));
      break;
    case 'octave':
      ev.pitches = ev.pitches.map((p) => ({ ...p, octave: p.octave + edit.delta }));
      break;
    case 'accidental':
      ev.pitches = ev.pitches.map((p, i) => (i === 0 ? { ...p, alter: edit.alter } : p));
      break;
    case 'length':
      ev.duration = edit.duration;
      delete ev.tuplet;
      break;
    case 'kind':
      if (edit.kind === 'rest') {
        ev.kind = 'rest';
        ev.pitches = [];
        delete ev.tieToNext;
        delete ev.lyrics;
      } else if (ev.kind === 'rest') {
        ev.kind = 'note';
        const before = events.slice(0, index).reverse().find((e) => e.kind === 'note');
        ev.pitches = before ? before.pitches.map((p) => ({ ...p })) : [{ ...DEFAULT_PITCH[part.id] }];
      }
      break;
    case 'tie':
      if (ev.kind === 'note') ev.tieToNext = !ev.tieToNext;
      break;
    case 'confirm':
      break;
    case 'delete':
      events.splice(index, 1);
      return copy;
  }
  ev.confidence = 1;
  return copy;
}

