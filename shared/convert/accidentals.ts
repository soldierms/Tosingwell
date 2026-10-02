// Accidental rules, as on a printed page:
//  1. The key signature applies to every note of that letter, in every octave.
//  2. An accidental (sharp, flat, natural) lasts until the end of the bar…
//  3. …but only for that letter in that same octave.
//  4. The bar line cancels it.
//  5. A note tied over a bar line keeps its accidental without showing it again.
//
// `readAccidentals` goes from WRITTEN notes to SOUNDING pitches (typed staff input, photo reading).
// `showAccidentals` goes from SOUNDING pitches to which accidentals to PRINT (staff display, staff text output).

import type { Key, Pitch, Step } from '../model/types';
import { keyAlter } from './pitch';

/** One note (or chord) in time order within a bar. */
export interface AccNote {
  /** For reading: the letter/octave and written accidental (undefined = none written). */
  written?: { step: Step; octave: number; accidental?: number }[];
  /** For showing: the sounding pitches. */
  pitches?: Pitch[];
  /** This note continues a tie from the previous note. */
  tiedFrom?: Pitch[];
  /** The key in force at this note (normally the bar's key signature). */
  key: Key;
}

const slot = (step: Step, octave: number) => `${step}${octave}`;

/**
 * Reads written notes one at a time, remembering accidentals until the bar ends.
 * Make a new reader for each bar (per staff).
 */
export function accidentalReader() {
  const state = new Map<string, number>();
  return (n: AccNote): Pitch[] =>
    (n.written ?? []).map((w) => {
      const k = slot(w.step, w.octave);
      const tied = n.tiedFrom?.find((p) => p.step === w.step && p.octave === w.octave);
      let alter: number;
      if (w.accidental !== undefined) {
        alter = w.accidental;
        state.set(k, alter);
      } else if (tied) {
        alter = tied.alter; // rule 5
      } else {
        alter = state.get(k) ?? keyAlter(w.step, n.key);
      }
      return { step: w.step, alter, octave: w.octave };
    });
}

/** Written notes → sounding pitches for a whole bar. */
export const readAccidentals = (notes: AccNote[]): Pitch[][] => notes.map(accidentalReader());

/**
 * Sounding pitches → accidental to print for each pitch (undefined = print none,
 * 0 = print a natural sign). Make a new one for each bar (per staff).
 */
export function accidentalShower() {
  const state = new Map<string, number>();
  return (n: AccNote): (number | undefined)[] =>
    (n.pitches ?? []).map((p) => {
      const k = slot(p.step, p.octave);
      const tied = n.tiedFrom?.some((t) => t.step === p.step && t.octave === p.octave && t.alter === p.alter);
      if (tied) return undefined;
      const current = state.get(k) ?? keyAlter(p.step, n.key);
      if (p.alter === current) return undefined;
      state.set(k, p.alter);
      return p.alter;
    });
}

/** Accidentals to print for a whole bar. */
export const showAccidentals = (notes: AccNote[]) => notes.map(accidentalShower());
