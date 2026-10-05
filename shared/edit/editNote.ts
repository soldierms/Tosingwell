// Small edits to one note, used by the review screen ("click a note to fix it").
// Every edit returns a NEW score (the old one is not changed) and marks the note
// as checked by you (confidence 1).

import type { Frac } from '../model/fraction';
import type { Pitch, Score, VoiceId } from '../model/types';
import { keyAt, eventStarts } from '../model/score';
import { defaultDohOctave, keyAlter, solfaToPitch, STEPS } from '../convert/pitch';
import { parsePulse } from '../solfa/parse';

/** Sol-fa for one note ("d'", "t,", "fe", "m+d") → its pitches in this key, or an error message. */
export function solfaNotePitches(text: string, key: Parameters<typeof keyAlter>[1], dohOctave: number, voice: VoiceId): Pitch[] | string {
  const t = text.trim();
  if (!t) return 'Type a syllable, e.g. d  r  m  t,  d\'';
  const r = parsePulse(t);
  const item = r.items[0];
  if (r.errors.length || r.items.length !== 1 || item.kind !== 'note' || !item.syllable) {
    return `“${t}” is not one sol-fa note. Use d r m f s l t (or de ra me fe se le ta), with ' for higher and , for lower.`;
  }
  const heads = [{ syllable: item.syllable, octave: item.octave ?? 0 }, ...(item.chord ?? [])];
  const pitches = heads.map((h) => solfaToPitch(h.syllable, h.octave, key, dohOctave, voice));
  return pitches.every(Boolean) ? (pitches as Pitch[]) : `“${t}” could not be turned into a note.`;
}

export type NoteEdit =
  | { type: 'step'; delta: 1 | -1 } // move up/down one letter (to the note that's in the key)
  | { type: 'octave'; delta: 1 | -1 }
  | { type: 'accidental'; alter: -1 | 0 | 1 } // flat, natural, sharp (what it should SOUND as)
  | { type: 'length'; duration: Frac }
  | { type: 'kind'; kind: 'note' | 'rest' }
  | { type: 'tie' }
  | { type: 'confirm' }
  | { type: 'delete' }
  | { type: 'solfa'; text: string }; // type the note in sol-fa: "d'", "t,", "fe", "m+d" (two notes)

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
    case 'solfa': {
      const pitches = solfaNotePitches(edit.text, key, copy.dohOctave ?? defaultDohOctave(key), part.id);
      if (typeof pitches === 'string') return score; // the editor shows the message instead
      ev.kind = 'note';
      ev.pitches = pitches;
      break;
    }
    case 'delete':
      events.splice(index, 1);
      return copy;
  }
  ev.confidence = 1;
  return copy;
}

