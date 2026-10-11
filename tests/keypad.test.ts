// The keypad must write exactly the rhythm that was tapped: check by reading its text back with the parser.
import { describe, expect, it } from 'vitest';
import { appendBar, renderBar, type Slot } from '../shared/solfa/keypad';
import { parseSolfa } from '../shared/solfa/parse';

const N = (syl: string): Slot => ({ kind: 'note', syl });
const H: Slot = { kind: 'hold' };
const R: Slot = { kind: 'rest' };
const note = (syl: string, len: number): Slot[] => [N(syl), ...Array(len - 1).fill(H)];
const rest = (len: number): Slot[] => [R, ...Array(len - 1).fill(H)];

/** Parse "Key: C Time: 4/4" + the bar; return events as "syl/len" (len in quarter-pulse slots, 4/4 → a quarter note is 4 slots). */
function readBack(bar: string, pulses = 4): string[] {
  const s = parseSolfa(`Key: C   Time: ${pulses}/4\nS: | ${bar} |\n`);
  const errs = s.flags.filter((f) => f.level === 'error');
  if (errs.length) throw new Error(`"${bar}": ${errs.map((e) => e.message).join('; ')}`);
  const out: string[] = [];
  let tied = false;
  for (const e of s.parts[0].measures[0].events) {
    const slots = (e.duration.n / e.duration.d) * 16;
    const last = out[out.length - 1];
    const kind = e.kind === 'rest' ? 'r' : 'n';
    // ties inside the bar merge into one sounding note
    if (last && kind === 'n' && tied) { out[out.length - 1] = last.replace(/\/(\d+)$/, (_, n) => `/${Number(n) + slots}`); }
    else if (last && kind === 'r' && last.startsWith('r/')) out[out.length - 1] = `r/${Number(last.slice(2)) + slots}`;
    else out.push(`${kind}/${slots}`);
    tied = !!e.tieToNext;
  }
  return out;
}

const cases: [string, Slot[], string[]][] = [
  ['four beats', [...note('d', 4), ...note('r', 4), ...note('m', 4), ...note('f', 4)], ['n/4', 'n/4', 'n/4', 'n/4']],
  ['halves', [...note('d', 2), ...note('r', 2), ...note('m', 4), ...note('f', 8)], ['n/2', 'n/2', 'n/4', 'n/8']],
  ['quarters', [...note('d', 1), ...note('r', 1), ...note('m', 1), ...note('f', 1), ...note('s', 12)], ['n/1', 'n/1', 'n/1', 'n/1', 'n/12']],
  ['dotted', [...note('d', 3), ...note('r', 1), ...note('m', 6), ...note('f', 2), ...note('s', 4)], ['n/3', 'n/1', 'n/6', 'n/2', 'n/4']],
  ['quarter then dotted', [...note('d', 1), ...note('r', 3), ...note('m', 12)], ['n/1', 'n/3', 'n/12']],
  ['rests', [...rest(4), ...note('d', 2), ...rest(2), ...note('r', 4), ...rest(4)], ['r/4', 'n/2', 'r/2', 'n/4', 'r/4']],
  ['rest mid-pulse then quarter', [...note('d', 2), ...rest(1), ...note('r', 1), ...note('m', 12)], ['n/2', 'r/1', 'n/1', 'n/12']],
  ['high and low', [...note("d'", 4), ...note('t,', 4), ...note('fe', 4), ...note('ta', 4)], ['n/4', 'n/4', 'n/4', 'n/4']],
];

describe('sol-fa keypad', () => {
  for (const [name, slots, want] of cases) {
    it(`writes ${name} so the parser reads the same rhythm`, () => {
      const bar = renderBar(slots);
      expect(readBack(bar)).toEqual(want);
    });
  }
  it('starts a bar with "-" when the last note is held over (a tie)', () => {
    expect(renderBar([H, H, H, H, ...note('r', 12)], { tiedIn: true }).startsWith('-')).toBe(true);
  });
  it('adds bars to the right part, after its last line', () => {
    const t = 'Key: C\nS: | d :r |\nA: | m :f |\nS-lyrics: la la\n';
    expect(appendBar(t, 'S', 'm :f')).toBe('Key: C\nS: | d :r |\nS: | m :f |\nA: | m :f |\nS-lyrics: la la\n');
    expect(appendBar('Key: C\nS: | d :r |]\n', 'S', 'm :f')).toBe('Key: C\nS: | d :r |\nS: | m :f |\n');
    expect(appendBar('Key: C\nS: | d |\nS-lyrics: x\n', 'T', 'd')).toBe('Key: C\nS: | d |\nT: | d |\nS-lyrics: x\n');
  });
});
