import { describe, expect, it } from 'vitest';
import { buildSchedule, tempoValue } from './schedule';
import { expandPlayOrder } from './expand';
import { parseSolfa } from '../solfa/parse';
import { parseStaffText } from '../staff/parse';
import { fixture } from '../../tests/helpers';
import type { Score } from '../model/types';

const sched = (s: Score, speed = 1) => buildSchedule(s, expandPlayOrder(s.measures).steps, { speed });
const sounding = (s: Score, part = 'S', speed = 1) => sched(s, speed).notes.filter((n) => n.part === part && !n.rest);
const r2 = (x: number) => Math.round(x * 100) / 100;

describe('playback schedule', () => {
  it('times notes from the tempo (quarter = 60 → one beat per second)', () => {
    const s = parseSolfa('Key: C\nTime: 4/4\nTempo: q=60\nS: | d :r :m :f |');
    expect(sounding(s).map((n) => [n.midi[0], r2(n.start)])).toEqual([[60, 0], [62, 1], [64, 2], [65, 3]]);
    expect(sched(s).duration).toBeCloseTo(4);
  });
  it('plays at half speed', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nTempo: q=60\nS: | d :r |');
    expect(sched(s, 0.5).duration).toBeCloseTo(4);
  });
  it('follows repeats: the same bars are played again later', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nTempo: q=60\nS: ||: d :r :|| m :- |');
    expect(sounding(s).map((n) => [n.midi[0], r2(n.start)])).toEqual([[60, 0], [62, 1], [60, 2], [62, 3], [64, 4]]);
  });
  it('joins tied notes into one long note, even across a bar line', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nTempo: q=60\nS: | d :m | - :r |');
    const n = sounding(s);
    expect(n.map((x) => [x.midi[0], r2(x.start), r2(x.end)])).toEqual([[60, 0, 0.94], [64, 1, 3], [62, 3, 3.94]]);
  });
  it('makes staccato notes short', () => {
    const s = parseStaffText('Key: C\nTime: 2/4\nTempo: q=60\nS: | C4q{stacc} D4q |');
    const [a, b] = sounding(s);
    expect(r2(a.end - a.start)).toBe(0.45);
    expect(r2(b.end - b.start)).toBe(0.94);
  });
  it('makes p soft and f loud, and an accent louder', () => {
    const s = parseStaffText('Key: C\nTime: 4/4\nS: | C4q{p} D4q E4q{f} F4q{acc} |');
    const v = sounding(s).map((n) => n.velocity);
    expect(v[0]).toBeLessThan(0.5);
    expect(v[1]).toBe(v[0]);
    expect(v[2]).toBeGreaterThan(0.7);
    expect(v[3]).toBeGreaterThan(v[2]);
  });
  it('gets louder through a crescendo hairpin', () => {
    const s = parseStaffText('Key: C\nTime: 4/4\nS: | C4q{p,cresc} D4q E4q F4q{/hp} | G4w{f} |');
    const v = sounding(s).map((n) => n.velocity);
    expect(v[0]).toBeLessThan(v[1]);
    expect(v[1]).toBeLessThan(v[2]);
    expect(v[2]).toBeLessThan(v[3]);
  });
  it('waits at a fermata (all parts)', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nTempo: q=60\nS: | d{ferm} :r |\nA: | s, :t, |');
    const all = sched(s).notes.filter((n) => !n.rest);
    const altoSecond = all.find((n) => n.part === 'A' && n.midi[0] === 59)!;
    expect(altoSecond.start).toBeCloseTo(2); // 1 beat + 1 beat of fermata pause
  });
  it('slows down during a rit.', () => {
    const s = parseSolfa('Key: C\nTime: 4/4\nTempo: q=60\nS: | d :d :d :d | [rit] d :d :d :d | d :- :- :- |');
    const n = sounding(s);
    const gap = (i: number) => n[i + 1].start - n[i].start;
    expect(gap(0)).toBeCloseTo(1);
    expect(gap(5)).toBeGreaterThan(gap(4));
    expect(gap(6)).toBeGreaterThan(1.1);
  });
  it('uses tempo words when no number is given', () => {
    expect(tempoValue({ text: 'Andante' }).bpm).toBe(76);
    expect(tempoValue(undefined).bpm).toBe(80);
  });
  it('plays grace notes just before the beat', () => {
    const s = parseStaffText('Key: C\nTime: 2/4\nTempo: q=60\nS: | C4q gE4s D4q |');
    const g = sched(s).notes.find((n) => n.grace)!;
    expect(g.end).toBeCloseTo(1);
    expect(g.start).toBeLessThan(1);
  });
  it('schedules the whole Evening Song with rests and ties for highlighting', () => {
    const s = parseSolfa(fixture('evening-song.solfa.txt'));
    const sc = sched(s);
    expect(sc.bars.length).toBe(17);
    expect(sc.notes.filter((n) => n.part === 'S').length).toBeGreaterThan(30);
    expect(sc.duration).toBeGreaterThan(30);
  });
});
