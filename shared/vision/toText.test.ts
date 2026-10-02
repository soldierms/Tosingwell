import { describe, expect, it } from 'vitest';
import { readingToText, withoutHeader } from './toText';
import type { ReadingBar, ReadingEvent, ReadingPitch, ScoreReading } from './schema';
import { parseStaffText } from '../staff/parse';
import { parseSolfa } from '../solfa/parse';
import { analyzeScore } from '../analysis/checks';
import { barsOf, fixture, lyricsOf } from '../../tests/helpers';

// ---- helpers to write a fake "Claude reading" compactly ----
const p = (s: string): ReadingPitch => {
  const m = /^([A-G])(#|b|n)?(\d)$/.exec(s)!;
  const acc = { '#': 'sharp', b: 'flat', n: 'natural' } as const;
  return { step: m[1] as ReadingPitch['step'], octave: Number(m[3]), accidental: m[2] ? acc[m[2] as '#'] : null };
};
const note = (pitch: string, length: ReadingEvent['length'] = 'half', extra: Partial<ReadingEvent> = {}): ReadingEvent => ({
  kind: 'note', pitches: [p(pitch)], length, dots: 0, tie: false, grace: false, tupletStart: null, tupletEnd: false,
  articulations: [], fermata: false, dynamic: null, hairpin: null, slur: null, lyric: null, confidence: 1, ...extra,
});
const bar = (number: number, events: ReadingEvent[], extra: Partial<ReadingBar> = {}): ReadingBar => ({
  number, events, solfa: null, solfaLyrics: null, repeatStart: false, repeatEnd: false, endBarline: 'single',
  directives: [], unreadable: false, problem: null, region: null, confidence: 1, ...extra,
});
const reading = (extra: Partial<ScoreReading>): ScoreReading => ({
  notation: 'staff', title: 'Old Hundredth', composer: 'Louis Bourgeois (melody)', key: 'G', time: '4/4', tempo: 'q=80',
  parts: [], questions: [], photoProblems: [], ...extra,
});
const two = (a: string, b: string, n: number, lyr?: [string, string], last = false) =>
  bar(n, [note(a, 'half', { lyric: lyr?.[0] ?? null }), note(b, 'half', { lyric: lyr?.[1] ?? null })], { endBarline: last ? 'final' : 'single' });

// Old Hundredth as Claude would report it from a printed page (F written without "#": key signature).
const OLD_100 = reading({
  parts: [
    { voice: 'S', clef: 'treble', bars: [two('G4', 'G4', 1, ['All', 'peo-']), two('F4', 'E4', 2, ['ple', 'that']), two('D4', 'G4', 3, ['on', 'earth']), two('A4', 'B4', 4, ['do', 'dwell,'], true)] },
    { voice: 'A', clef: 'treble', bars: [two('D4', 'E4', 1), two('D4', 'B3', 2), two('A3', 'D4', 3), two('E4', 'D4', 4, undefined, true)] },
    { voice: 'T', clef: 'bass', bars: [two('B3', 'B3', 1), two('A3', 'G3', 2), two('F3', 'B3', 3), two('C4', 'G3', 4, undefined, true)] },
    { voice: 'B', clef: 'bass', bars: [two('G3', 'E3', 1), two('D3', 'E3', 2), two('D3', 'G2', 3), two('C3', 'G2', 4, undefined, true)] },
  ],
});

describe('photo reading → score', () => {
  it('gives exactly the same notes as the typed Old Hundredth, bar by bar', () => {
    const r = readingToText(OLD_100);
    expect(r.format).toBe('staff');
    expect(r.notes).toEqual([]);
    const fromPhoto = parseStaffText(r.text);
    const expected = parseStaffText(fixture('old-hundredth.staff.txt'));
    for (const v of ['S', 'A', 'T', 'B']) expect(barsOf(fromPhoto, v), v).toEqual(barsOf(expected, v));
    expect(lyricsOf(fromPhoto, 'S')).toEqual(lyricsOf(expected, 'S'));
    expect(fromPhoto.flags.filter((f) => f.level === 'error')).toEqual([]);
  });

  it('applies the key signature and accidental rules to what was printed', () => {
    const r = readingToText(reading({
      parts: [{ voice: 'S', clef: 'treble', bars: [bar(1, [note('F4', 'quarter'), note('Fn4', 'quarter'), note('F4', 'quarter'), note('F#5', 'quarter')])] }],
    }));
    expect(barsOf(parseStaffText(r.text), 'S')[0]).toBe('F#4@0:1/4 F4@1/4:1/4 F4@1/2:1/4 F#5@3/4:1/4');
  });

  it('reads an octave-treble tenor an octave lower than written', () => {
    const r = readingToText(reading({ parts: [{ voice: 'T', clef: 'treble8vb', bars: [bar(1, [note('C4', 'whole')])] }] }));
    expect(barsOf(parseStaffText(r.text), 'T')[0]).toBe('C3@0:1');
  });

  it('keeps per-note confidence so uncertain notes are marked', () => {
    const r = readingToText(reading({ parts: [{ voice: 'S', clef: 'treble', bars: [bar(1, [note('G4', 'half', { confidence: 0.55 }), note('A4')])] }] }));
    const s = parseStaffText(r.text);
    expect(s.parts[0].measures[0].events[0].confidence).toBe(0.55);
    expect(analyzeScore(s).some((f) => f.code === 'low-confidence' && f.message.includes('55%'))).toBe(true);
  });

  it('never invents notes for an unreadable bar — it stays empty and is flagged', () => {
    const r = readingToText(reading({
      parts: [{ voice: 'S', clef: 'treble', bars: [two('G4', 'G4', 1), bar(2, [], { unreadable: true, problem: 'glare covers this bar' }), two('D4', 'G4', 3)] }],
    }));
    expect(r.notes.some((n) => n.level === 'error' && n.message.includes('Soprano, bar 2') && n.message.includes('glare'))).toBe(true);
    const s = parseStaffText(r.text);
    const ev = s.parts[0].measures[1].events;
    expect(ev.length).toBe(1);
    expect(ev[0].kind).toBe('rest');
    expect(ev[0].confidence).toBe(0);
  });

  it('passes on repeats, endings, D.C., dynamics, ties and triplets', () => {
    const r = readingToText(reading({
      time: '2/4',
      parts: [{
        voice: 'S', clef: 'treble', bars: [
          bar(1, [note('G4', 'quarter', { dynamic: 'p' }), note('A4', 'quarter', { tie: true })], { repeatStart: true }),
          bar(2, [note('A4', 'eighth', { tupletStart: { actual: 3, normal: 2 } }), note('B4', 'eighth'), note('C5', 'eighth', { tupletEnd: true }), note('D5', 'quarter', { fermata: true })], { repeatEnd: true, directives: ['ending:1'] }),
          bar(3, [note('G4', 'half')], { directives: ['ending:2', 'D.C. al Fine'], endBarline: 'final' }),
        ],
      }],
    }));
    const s = parseStaffText(r.text);
    expect(s.flags.filter((f) => f.level === 'error')).toEqual([]);
    expect(s.measures[0].repeatStart).toBe(true);
    expect(s.measures[1].repeatEnd).toBe(true);
    expect(s.measures[1].ending?.numbers).toEqual([1]);
    expect(s.measures[2].jump).toBe('D.C. al Fine');
    const ev = s.parts[0].measures;
    expect(ev[0].events[0].dynamic).toBe('p');
    expect(ev[0].events[1].tieToNext).toBe(true);
    expect(ev[1].events[0].tuplet).toMatchObject({ actual: 3, normal: 2 });
    expect(ev[1].events[3].fermata).toBe(true);
  });

  it('reads a sol-fa score through the sol-fa parser', () => {
    const solfaBars = (rows: string[], lyr?: string[]): ReadingBar[] =>
      rows.map((t, i) => bar(i + 1, [], { solfa: t, solfaLyrics: lyr?.[i] ?? null, endBarline: i === rows.length - 1 ? 'final' : 'single' }));
    const r = readingToText(reading({
      notation: 'solfa', key: 'Doh is G',
      parts: [
        { voice: 'S', clef: 'none', bars: solfaBars(['d :- :d :-', 't, :- :l, :-', 's, :- :d :-', 'r :- :m :-'], ['All peo-', 'ple that', 'on earth', 'do dwell,']) },
        { voice: 'B', clef: 'none', bars: solfaBars(['d :- :l, :-', 's, :- :l, :-', 's, :- :d, :-', 'f, :- :d, :-']) },
      ],
    }));
    expect(r.format).toBe('solfa');
    const s = parseSolfa(r.text);
    const expected = parseSolfa(fixture('old-hundredth.solfa.txt'));
    expect(barsOf(s, 'S')).toEqual(barsOf(expected, 'S'));
    expect(barsOf(s, 'B')).toEqual(barsOf(expected, 'B'));
    expect(lyricsOf(s, 'S')).toEqual(lyricsOf(expected, 'S'));
  });

  it('turns photo problems and questions into notes for the review screen', () => {
    const r = readingToText(reading({ key: null, photoProblems: ['the right edge is cut off'], questions: ['Is bar 3 a D or an E in the alto?'], parts: [] }));
    const msgs = r.notes.map((n) => n.message).join('\n');
    expect(msgs).toContain('cut off');
    expect(msgs).toContain('bar 3');
    expect(msgs).toContain('No key');
    expect(msgs).toContain('No voice parts');
  });

  it('can add a second page without repeating the header', () => {
    const page2 = withoutHeader(readingToText(OLD_100).text);
    expect(page2).not.toContain('Title:');
    expect(page2).toContain('S: |');
  });
});
