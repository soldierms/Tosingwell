// The test library: known scores, each typed in BOTH notations. The reader
// must get exactly the same music from both, bar by bar, and converting in
// either direction must not change a single note.

import { describe, expect, it } from 'vitest';
import { parseSolfa } from '../shared/solfa/parse';
import { parseStaffText } from '../shared/staff/parse';
import { writeSolfa } from '../shared/solfa/write';
import { writeStaffText } from '../shared/staff/write';
import { analyzeScore } from '../shared/analysis/checks';
import { barsOf, fixture, lyricsOf, marksOf, structureOf } from './helpers';
import type { Score } from '../shared/model/types';

const VOICES = ['S', 'A', 'T', 'B'];

function expectSameMusic(a: Score, b: Score) {
  expect(structureOf(b)).toEqual(structureOf(a));
  for (const v of VOICES) {
    expect(barsOf(b, v), `${v} notes`).toEqual(barsOf(a, v));
    expect(lyricsOf(b, v), `${v} lyrics`).toEqual(lyricsOf(a, v));
    expect(marksOf(b, v), `${v} marks`).toEqual(marksOf(a, v));
  }
}

const errorsAndWarnings = (s: Score) => [...s.flags, ...analyzeScore(s)].filter((f) => f.level !== 'info').map((f) => f.message);

for (const name of ['old-hundredth', 'evening-song']) {
  describe(`library: ${name}`, () => {
    const fromSolfa = parseSolfa(fixture(`${name}.solfa.txt`));
    const fromStaff = parseStaffText(fixture(`${name}.staff.txt`));

    it('reads without errors or warnings', () => {
      expect(errorsAndWarnings(fromSolfa)).toEqual([]);
      expect(errorsAndWarnings(fromStaff)).toEqual([]);
    });

    it('sol-fa and staff versions give the same music, bar by bar', () => {
      expectSameMusic(fromSolfa, fromStaff);
    });

    it('Sol-fa → Staff → back gives the same notes', () => {
      const staffText = writeStaffText(fromSolfa).text;
      const back = parseStaffText(staffText);
      expectSameMusic(fromSolfa, back);
      expect(errorsAndWarnings(back)).toEqual([]);
    });

    it('Staff → Sol-fa → back gives the same notes', () => {
      const { text, flags } = writeSolfa(fromStaff);
      expect(flags.filter((f) => f.level !== 'info')).toEqual([]);
      const back = parseSolfa(text);
      expectSameMusic(fromStaff, back);
    });

    it('writing sol-fa twice gives identical text', () => {
      const once = writeSolfa(fromSolfa).text;
      const twice = writeSolfa(parseSolfa(once)).text;
      expect(twice).toBe(once);
    });
  });
}

describe('library: expected answers', () => {
  it('Old Hundredth soprano', () => {
    const s = parseSolfa(fixture('old-hundredth.solfa.txt'));
    expect(barsOf(s, 'S')).toEqual([
      'G4@0:1/2 G4@1/2:1/2',
      'F#4@0:1/2 E4@1/2:1/2',
      'D4@0:1/2 G4@1/2:1/2',
      'A4@0:1/2 B4@1/2:1/2',
    ]);
    expect(lyricsOf(s, 'S')).toEqual(['All', 'peo-', 'ple', 'that', 'on', 'earth', 'do', 'dwell,']);
  });

  it('Evening Song structure', () => {
    const s = parseSolfa(fixture('evening-song.solfa.txt'));
    expect(structureOf(s)).toEqual([
      '#0 3/4 D0major pickup tempo:Andante88',
      '#1 3/4 D0major ||:',
      '#2 3/4 D0major',
      '#3 3/4 D0major :|| ending1[]',
      '#4 3/4 D0major ending2[]',
      '#5 3/4 D0major',
      '#6 3/4 D0major fine',
      '#7 3/4 D0major rit@0',
      '#8 3/4 D0major D.C. al Fine',
    ]);
    expect(barsOf(s, 'S')[7]).toBe('F#4@0:3/16 E4@3/16:1/16 D4@1/4:1/4 C#4@1/2:1/4');
    expect(barsOf(s, 'B')[5]).toBe('A2@0:1/4 F#2@1/4:1/4 G#2@1/2:1/4');
    // The melisma: "end-" is held over two notes.
    expect(lyricsOf(s, 'S').slice(3, 6)).toEqual(['is', 'end-_', 'ing']);
  });
});
