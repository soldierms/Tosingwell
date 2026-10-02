import { describe, expect, it } from 'vitest';
import {
  defaultDohOctave,
  keyAlter,
  keyFifths,
  keyLabel,
  parseKey,
  pitchName,
  pitchToSolfa,
  solfaToPitch,
} from './pitch';
import type { Key } from '../model/types';

const key = (t: string) => parseKey(t)!;

describe('keys', () => {
  it('counts sharps and flats', () => {
    expect(keyFifths(key('C'))).toBe(0);
    expect(keyFifths(key('G'))).toBe(1);
    expect(keyFifths(key('F#'))).toBe(6);
    expect(keyFifths(key('Bb'))).toBe(-2);
    expect(keyFifths(key('Db'))).toBe(-5);
  });
  it('knows which letters the key signature changes', () => {
    expect(keyAlter('F', key('G'))).toBe(1);
    expect(keyAlter('C', key('G'))).toBe(0);
    expect(keyAlter('E', key('Bb'))).toBe(-1);
    expect(keyAlter('A', key('Bb'))).toBe(0);
    expect(keyAlter('B', key('C#'))).toBe(1);
  });
  it('reads minor keys as lah-mode (doh = relative major)', () => {
    const am = key('A minor');
    expect(am.doh).toEqual({ step: 'C', alter: 0 });
    expect(am.mode).toBe('minor');
    expect(key('Em').doh).toEqual({ step: 'G', alter: 0 });
    expect(key('C minor').doh).toEqual({ step: 'E', alter: -1 });
    expect(keyLabel(key('E minor'))).toBe('E minor (Doh = G, Lah = E)');
  });
  it('accepts "doh = G"', () => {
    expect(key('doh = Eb').doh).toEqual({ step: 'E', alter: -1 });
  });
});

describe('sol-fa ↔ pitch (movable doh)', () => {
  const p = (syl: string, oct: number, k: Key, voice: 'S' | 'A' | 'T' | 'B' = 'S') =>
    pitchName(solfaToPitch(syl, oct, k, defaultDohOctave(k), voice)!);

  it('places doh by key', () => {
    expect(p('d', 0, key('C'))).toBe('C4');
    expect(p('d', 0, key('G'))).toBe('G4');
    expect(p('d', 0, key('A'))).toBe('A3');
    expect(p('m', 0, key('G'))).toBe('B4');
    expect(p('t', -1, key('G'))).toBe('F#4');
    expect(p('d', 1, key('Eb'))).toBe('Eb5');
  });
  it('handles chromatic syllables', () => {
    expect(p('fe', 0, key('C'))).toBe('F#4');
    expect(p('ta', 0, key('C'))).toBe('Bb4');
    expect(p('se', 0, key('F'))).toBe('C#5');
    expect(p('me', 0, key('D'))).toBe('F4');
    expect(p('de', 0, key('Bb'))).toBe('B3');
    expect(p('ra', 0, key('G'))).toBe('Ab4');
    // alternate spellings
    expect(p('fi', 0, key('C'))).toBe('F#4');
    expect(p('si', 0, key('C'))).toBe('G#4');
    expect(p('te', 0, key('C'))).toBe('Bb4');
  });
  it('writes tenor and bass an octave higher than they sound', () => {
    expect(p('d', 0, key('C'), 'T')).toBe('C3');
    expect(p('s', -1, key('C'), 'B')).toBe('G2');
  });
  it('converts back from pitch to syllable', () => {
    const g = key('G');
    expect(pitchToSolfa({ step: 'F', alter: 1, octave: 4 }, g, 4, 'S')).toEqual({ syllable: 't', octave: -1 });
    expect(pitchToSolfa({ step: 'C', alter: 1, octave: 5 }, g, 4, 'S')).toEqual({ syllable: 'fe', octave: 0 });
    expect(pitchToSolfa({ step: 'G', alter: 0, octave: 2 }, g, 4, 'B')).toEqual({ syllable: 'd', octave: -1 });
  });
  it('respells notes with no sol-fa name, keeping the same sound', () => {
    const r = pitchToSolfa({ step: 'E', alter: 1, octave: 4 }, key('C'), 4, 'S');
    expect(r).toEqual({ syllable: 'f', octave: 0, respelled: true });
  });
  it('round-trips every syllable in every octave and several keys', () => {
    for (const k of ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Ab', 'F#'].map(key)) {
      for (const syl of ['d', 'de', 'ra', 'r', 'ri', 'me', 'm', 'f', 'fe', 's', 'se', 'le', 'l', 'li', 'ta', 't']) {
        for (const oct of [-1, 0, 1]) {
          const pitch = solfaToPitch(syl, oct, k, 4, 'A')!;
          expect(pitchToSolfa(pitch, k, 4, 'A')).toEqual({ syllable: syl, octave: oct });
        }
      }
    }
  });
});
