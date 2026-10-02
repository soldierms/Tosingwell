import { describe, expect, it } from 'vitest';
import { contentHeights, contentWidth, keyPrintLabel, pageSize, paginate, printMetaLine } from './paginate';
import { parseKey } from '../convert/pitch';
import { parseSolfa } from '../solfa/parse';

describe('page sizes', () => {
  it('knows A4 and US Letter in both orientations', () => {
    expect(pageSize('A4', 'portrait')).toMatchObject({ widthMm: 210, heightMm: 297, width: 793, height: 1122 });
    expect(pageSize('A4', 'landscape')).toMatchObject({ widthMm: 297, heightMm: 210 });
    expect(pageSize('Letter', 'portrait')).toMatchObject({ width: 816, height: 1056 });
    expect(contentWidth('A4', 'landscape')).toBeGreaterThan(contentWidth('A4', 'portrait'));
    const h = contentHeights('A4', 'portrait');
    expect(h.first).toBeLessThan(h.other);
  });
});

describe('paginate (never split a line of music)', () => {
  it('fills pages in order and breaks only between lines', () => {
    expect(paginate([300, 300, 300, 300, 300], 700, 900)).toEqual([[0, 1], [2, 3, 4]]);
  });
  it('puts everything on one page when it fits', () => {
    expect(paginate([100, 100], 700, 900)).toEqual([[0, 1]]);
  });
  it('gives a too-tall line its own page instead of cutting it', () => {
    expect(paginate([200, 1000, 200], 700, 900)).toEqual([[0], [1], [2]]);
  });
  it('returns one empty page for an empty score', () => {
    expect(paginate([], 700, 900)).toEqual([[]]);
  });
});

describe('page header text', () => {
  it('writes the key with doh', () => {
    expect(keyPrintLabel(parseKey('G')!)).toBe('Key: G, Doh = G');
    expect(keyPrintLabel(parseKey('Eb')!)).toBe('Key: E♭, Doh = E♭');
    expect(keyPrintLabel(parseKey('E minor')!)).toBe('Key: E minor, Doh = G');
  });
  it('writes key, time and tempo', () => {
    const s = parseSolfa('Key: D\nTime: 3/4\nTempo: Andante q=88\nS: | d :r :m |');
    expect(printMetaLine(s)).toBe('Key: D, Doh = D   ·   Time: 3/4   ·   Tempo: Andante q=88');
  });
});
