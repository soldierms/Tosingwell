import { describe, expect, it } from 'vitest';
import { parsePulse, parseSolfa } from './parse';
import { fracToString } from '../model/fraction';
import { pitchName } from '../convert/pitch';
import type { Score } from '../model/types';

/** Short summary of one part: "G4:1/4 r:1/8 …" per bar. */
function bars(score: Score, voice = 'S'): string[] {
  const part = score.parts.find((p) => p.id === voice)!;
  return part.measures.map((m) =>
    m.events
      .map((e) => (e.kind === 'rest' ? 'r' : e.pitches.map(pitchName).join('+')) + ':' + fracToString(e.duration) + (e.tieToNext ? '~' : '') + (e.tuplet ? '(3)' : ''))
      .join(' '),
  );
}

const errors = (s: Score) => s.flags.filter((f) => f.level === 'error');

describe('pulse divisions', () => {
  const pos = (t: string) => parsePulse(t).items.map((i) => `${i.kind}@${fracToString(i.pos)}`);
  it('reads halves and quarters', () => {
    expect(pos('d')).toEqual(['note@0']);
    expect(pos('d.r')).toEqual(['note@0', 'note@1/2']);
    expect(pos('d,r.m')).toEqual(['note@0', 'note@1/4', 'note@1/2']);
    expect(pos('d.,r')).toEqual(['note@0', 'skip@1/2', 'note@3/4']);
    expect(pos('d.r,m')).toEqual(['note@0', 'note@1/2', 'note@3/4']);
  });
  it('reads triplets (two dots)', () => {
    expect(pos('d.r.m')).toEqual(['note@0', 'note@1/3', 'note@2/3']);
  });
  it('reads rests and holds', () => {
    expect(pos('')).toEqual(['rest@0']);
    expect(pos('.r')).toEqual(['rest@0', 'note@1/2']);
    expect(pos('-.r')).toEqual(['hold@0', 'note@1/2']);
  });
  it('tells octave commas from quarter-pulse commas', () => {
    const it1 = parsePulse('s,').items;
    expect(it1.length).toBe(1);
    expect(it1[0].octave).toBe(-1);
    const it2 = parsePulse('s,,r').items; // low s, then r a quarter later
    expect(it2.map((i) => i.octave)).toEqual([-1, 0]);
    expect(fracToString(it2[1].pos)).toBe('1/4');
    const it3 = parsePulse('s,.l,').items; // low s, low l (halves)
    expect(it3.map((i) => i.octave)).toEqual([-1, -1]);
    expect(parsePulse('d₁').items[0].octave).toBe(-1);
    expect(parsePulse("d''").items[0].octave).toBe(2);
    expect(parsePulse('d²').items[0].octave).toBe(2);
  });
  it('reads bridge notes', () => {
    const [item] = parsePulse('s/d').items;
    expect(item.bridge).toBe('s');
    expect(item.syllable).toBe('d');
  });
  it('reports what it cannot read', () => {
    expect(parsePulse('dx').errors.length).toBeGreaterThan(0);
    expect(parsePulse('re').errors.length).toBeGreaterThan(0);
  });
});

describe('parseSolfa', () => {
  it('reads a simple 4/4 line', () => {
    const s = parseSolfa('Key: C\nTime: 4/4\nS: | d :r :m :f | s :- :- :- |');
    expect(errors(s)).toEqual([]);
    expect(bars(s)).toEqual(['C4:1/4 D4:1/4 E4:1/4 F4:1/4', 'G4:1']);
  });
  it('holds across a bar line become ties', () => {
    const s = parseSolfa('Key: G\nTime: 3/4\nS: | d :- :m | - :r :d |');
    expect(bars(s)).toEqual(['G4:1/2 B4:1/4~', 'B4:1/4 A4:1/4 G4:1/4']);
  });
  it('reads rests, half-pulses and dotted rhythms', () => {
    const s = parseSolfa('Key: D\nTime: 2/4\nS: | d.,r :m | :s.s |');
    expect(bars(s)).toEqual(['D4:3/16 E4:1/16 F#4:1/4', 'r:1/4 A4:1/8 A4:1/8']);
  });
  it('reads triplets', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d.r.m :f |');
    expect(bars(s)).toEqual(['C4:1/12(3) D4:1/12(3) E4:1/12(3) F4:1/4']);
  });
  it('reads 6/8 as six pulses of an eighth', () => {
    const s = parseSolfa('Key: F\nTime: 6/8\nS: | d :- :r :m :- :f |');
    expect(bars(s)).toEqual(['F4:1/4 G4:1/8 A4:1/4 Bb4:1/8']);
  });
  it('detects a pickup bar', () => {
    const s = parseSolfa('Key: G\nTime: 4/4\nS: :s, | d :- :d :r |');
    expect(s.measures[0].pickup).toBe(true);
    expect(s.measures[0].number).toBe(0);
    expect(bars(s)[0]).toBe('D4:1/4');
  });
  it('places tenor and bass an octave below the written sol-fa', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nT: | m :s |\nB: | d :s, |');
    expect(bars(s, 'T')).toEqual(['E3:1/4 G3:1/4']);
    expect(bars(s, 'B')).toEqual(['C3:1/4 G2:1/4']);
  });
  it('changes key with a bridge note and checks it', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :[key:G]s/d | r :- |');
    expect(errors(s)).toEqual([]);
    expect(s.flags.filter((f) => f.code === 'bridge')).toEqual([]);
    expect(bars(s)).toEqual(['C4:1/4 G4:1/4', 'A4:1/2']);
    expect(s.measures[0].keyChanges?.[0].key.doh.step).toBe('G');
    expect(s.measures[1].key.doh.step).toBe('G');
    const bad = parseSolfa('Key: C\nTime: 2/4\nS: | d :[key:G]r/d |');
    expect(bad.flags.some((f) => f.code === 'bridge')).toBe(true);
  });
  it('reads repeats, endings and D.C.', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: ||: d :r | [ending:1] m :- :|| [ending:2] f :- || [fine] s :- | l :- [D.C. al Fine] |]');
    const m = s.measures;
    expect(m[0].repeatStart).toBe(true);
    expect(m[1].ending).toEqual({ numbers: [1], start: true, end: true });
    expect(m[1].repeatEnd).toBe(true);
    expect(m[2].ending).toEqual({ numbers: [2], start: true, end: true });
    expect(m[3].fine).toBe(true);
    expect(m[4].jump).toBe('D.C. al Fine');
    expect(m[4].finalBar).toBe(true);
  });
  it('reads marks and lyrics with melismas', () => {
    const s = parseSolfa('Key: C\nTime: 4/4\nS: | d{p} :r{stacc} :m.f{(} :s{)} |\nS-lyrics: Glo-ry to _ God');
    const ev = s.parts[0].measures[0].events;
    expect(ev[0].dynamic).toBe('p');
    expect(ev[1].articulations).toEqual(['staccato']);
    expect(ev.map((e) => e.lyrics?.[0]?.text)).toEqual(['Glo', 'ry', 'to', undefined, 'God']);
    expect(ev[2].lyrics?.[0].extend).toBe(true);
    expect(ev[0].lyrics?.[0].syllabic).toBe('begin');
  });
  it('continues a part over several lines', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :r |\nS: | m :f |');
    expect(bars(s)).toEqual(['C4:1/4 D4:1/4', 'E4:1/4 F4:1/4']);
  });
  it('flags lines and notes it cannot read', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :x |\nhello');
    expect(errors(s).length).toBe(1);
    expect(s.flags.some((f) => f.code === 'unread-line')).toBe(true);
  });
});

describe('bar lines', () => {
  it('treats ":|| ||:" as two signs, not an empty bar', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: ||: d :r :|| ||: m :f :||');
    expect(s.measures.length).toBe(2);
    expect(s.measures[0].repeatEnd).toBe(true);
    expect(s.measures[1].repeatStart).toBe(true);
  });
  it('keeps "| |" as a whole-bar rest', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: | d :r | | m :f |');
    expect(bars(s)).toEqual(['C4:1/4 D4:1/4', 'r:1/2', 'E4:1/4 F4:1/4']);
  });
});

describe('compound time written with "/" and no time signature', () => {
  it('treats "/" as a pulse mark but keeps bridge notes', () => {
    const s = parseSolfa('Key: C\nTime: 6/8\nS: | d :r :m / f :s :l | s :- :- / - :- :- |');
    expect(errors(s)).toEqual([]);
    expect(bars(s)[0]).toBe('C4:1/8 D4:1/8 E4:1/8 F4:1/8 G4:1/8 A4:1/8');
    const b = parseSolfa('Key: C\nTime: 2/4\nS: | d :[key:G]s/d | r :- |');
    expect(b.flags.filter((f) => f.code === 'bridge')).toEqual([]);
    expect(bars(b)[0]).toBe('C4:1/4 G4:1/4');
  });
  it('ignores a stray "/" just before the bar line', () => {
    const s = parseSolfa('Key: C\nTime: 3/4\nS: | d :r :m / | f :- :- |');
    expect(bars(s)[0]).toBe('C4:1/4 D4:1/4 E4:1/4');
  });
  it('works out 6/8 when no time signature is given, and says so', () => {
    const s = parseSolfa('Key: Bb\nS: | s :s :- / l :- :- | t :t :- / d\' :s :- |\nA: | m :m :- / f :- :- | s :s :- / m :m :- |');
    expect(s.measures[0].time).toEqual({ beats: 6, beatType: 8 });
    expect(s.flags.some((f) => f.message.includes('worked out from the bars: 6/8'))).toBe(true);
    expect(s.flags.filter((f) => f.level === 'error')).toEqual([]);
  });
  it('works out 3/4 too', () => {
    const s = parseSolfa('Key: C\nS: | d :r :m | f :s :l | t :- :- |');
    expect(s.measures[0].time).toEqual({ beats: 3, beatType: 4 });
  });
});
