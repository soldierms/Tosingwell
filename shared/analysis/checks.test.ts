import { describe, expect, it } from 'vitest';
import { analyzeScore, checkBarCounts, checkBarLengths, checkRanges, checkRepeats } from './checks';
import { summarize } from './summary';
import { parseSolfa } from '../solfa/parse';
import { parseStaffText } from '../staff/parse';

const codes = (flags: { code: string; level: string }[], level = 'warning') =>
  flags.filter((f) => f.level === level || (level === 'warning' && f.level === 'error')).map((f) => f.code);

describe('rhythm check (bar length vs time signature)', () => {
  it('accepts correct bars', () => {
    const s = parseSolfa('Key: C\nTime: 3/4\nS: | d :r :m | f :- :s |');
    expect(checkBarLengths(s)).toEqual([]);
  });
  it('flags a bar that is too long or too short', () => {
    const s = parseSolfa('Key: C\nTime: 3/4\nS: | d :r :m :f | f :- | s :- :- |');
    const f = checkBarLengths(s);
    expect(f.map((x) => x.measure)).toEqual([0, 1]);
    expect(f[0].message).toContain('too long');
    expect(f[0].message).toContain('4 beats');
    expect(f[1].message).toContain('too short');
  });
  it('flags staff bars that do not add up', () => {
    const s = parseStaffText('Key: C\nTime: 4/4\nS: | C4w | C4q D4q E4q |');
    expect(checkBarLengths(s)[0].message).toContain('3 beats');
  });
  it('allows a pickup bar and a matching short last bar', () => {
    const s = parseSolfa('Key: C\nTime: 4/4\nS: :s, | d :- :r :m | f :- :- |');
    const f = checkBarLengths(s);
    expect(f.filter((x) => x.level === 'error')).toEqual([]);
    expect(f.some((x) => x.level === 'info')).toBe(true);
  });
  it('handles triplets and dotted notes', () => {
    const s = parseStaffText('Key: C\nTime: 2/4\nS: | (3 C4e D4e E4e) F4q | G4e. A4s B4q | C5q.. D5s |');
    expect(checkBarLengths(s)).toEqual([]);
  });
});

describe('bar count across parts', () => {
  it('flags parts with different numbers of bars', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :r | m :f |\nA: | d :d |');
    expect(checkBarCounts(s)[0].message).toContain('Soprano 2, Alto 1');
  });
});

describe('voice ranges', () => {
  it('warns when a voice goes outside its usual range', () => {
    const s = parseStaffText('Key: C\nTime: 2/4\nS: | C6q C4q |\nB: | C2q C3q |');
    const f = checkRanges(s);
    expect(f.map((x) => x.part)).toEqual(['S', 'B']);
    expect(f[0].message).toContain('above');
    expect(f[1].message).toContain('below');
  });
});

describe('accidental rules (typed staff)', () => {
  const pitches = (text: string) =>
    parseStaffText(text).parts[0].measures.map((m) => m.events.map((e) => e.pitches.map((p) => `${p.step}${['bb', 'b', '', '#', '##'][p.alter + 2]}${p.octave}`).join('+')).join(' '));

  it('applies the key signature', () => {
    expect(pitches('Key: D\nTime: 2/4\nS: | F4q C5q |')).toEqual(['F#4 C#5']);
  });
  it('keeps an accidental to the end of the bar, same octave only', () => {
    expect(pitches('Key: C\nTime: 4/4\nS: | F#4q F4q F5q F4q | F4w |')).toEqual(['F#4 F#4 F5 F#4', 'F4']);
  });
  it('a natural cancels the key signature until the bar line', () => {
    expect(pitches('Key: G\nTime: 4/4\nS: | Fn4q F4q G4h | F4w |')).toEqual(['F4 F4 G4', 'F#4']);
  });
  it('a tied note keeps its accidental across the bar line', () => {
    expect(pitches('Key: C\nTime: 2/4\nS: | rq Bb4q~ | B4q B4q |')).toEqual([' Bb4', 'Bb4 B4']);
  });
  it('applies inside chords', () => {
    expect(pitches('Key: C\nTime: 2/4\nS: | <C#4 E4>q <C4 Eb4>q |')).toEqual(['C#4+E4 C#4+Eb4']);
  });
});

describe('repeat and ending consistency', () => {
  it('accepts a normal repeat with endings', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: ||: d :r | [ending:1] m :- :|| [ending:2] f :- |]');
    expect(checkRepeats(s.measures)).toEqual([]);
  });
  it('flags a start-repeat with no end', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :r ||: m :- | f :- |]');
    expect(checkRepeats(s.measures)[0].message).toContain('no end-repeat');
  });
  it('flags D.S. with no Segno, al Coda with no Coda, and Fine with no D.C.', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :r | m :- [D.S. al Coda] |');
    const msgs = checkRepeats(s.measures).map((f) => f.message).join('\n');
    expect(msgs).toContain('no Segno');
    expect(msgs).toContain('no Coda');
    const s2 = parseSolfa('Key: C\nTime: 2/4\nS: | d :r [fine] | m :- |');
    expect(checkRepeats(s2.measures)[0].message).toContain('Fine but no');
  });
  it('flags endings out of order', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: ||: d :r | [ending:2] m :- :|| [ending:1] f :- |]');
    expect(codes(checkRepeats(s.measures))).toContain('repeat');
  });
});

describe('low confidence and ties', () => {
  it('flags uncertain notes', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d{conf=0.4} :r |');
    expect(analyzeScore(s).some((f) => f.code === 'low-confidence' && f.message.includes('40%'))).toBe(true);
  });
  it('flags a tie between different notes', () => {
    const s = parseStaffText('Key: C\nTime: 2/4\nS: | C4q~ D4q |');
    expect(analyzeScore(s).some((f) => f.code === 'tie')).toBe(true);
  });
});

describe('summary', () => {
  it('describes key, doh, time, tempo, parts and structure', () => {
    const s = parseSolfa('Key: E minor\nTime: 6/8\nTempo: Allegro q.=100\nS: ||: d :r :m :f :s :l :||\nA: ||: d :d :d :d :d :d :||');
    const sum = summarize(s, analyzeScore(s));
    expect(sum.key).toBe('E minor (Doh = G, Lah = E)');
    expect(sum.doh).toBe('G');
    expect(sum.time).toBe('6/8');
    expect(sum.tempo).toBe('Allegro q.=100');
    expect(sum.parts).toEqual(['Soprano', 'Alto']);
    expect(sum.structure).toEqual(['Repeat from bar 1 to bar 1']);
  });
});
