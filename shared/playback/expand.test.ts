import { describe, expect, it } from 'vitest';
import { describePlayOrder, expandPlayOrder } from './expand';
import { parseSolfa } from '../solfa/parse';
import { fixture } from '../../tests/helpers';

/** Play order as written bar numbers (pickup = 0) for a sol-fa soprano line in 2/4. */
function order(line: string, opts = {}) {
  const s = parseSolfa(`Key: C\nTime: 2/4\nS: ${line}`);
  return expandPlayOrder(s.measures, opts).steps.map((st) => s.measures[st.measure].number);
}

describe('play order (repeat expansion)', () => {
  it('plays straight through with no repeats', () => {
    expect(order('| d :r | m :f | s :- |]')).toEqual([1, 2, 3]);
  });
  it('repeats a section once', () => {
    expect(order('| d :r ||: m :f | s :l :|| t :- |]')).toEqual([1, 2, 3, 2, 3, 4]);
  });
  it('an end-repeat with no start goes back to the beginning', () => {
    expect(order('| d :r | m :f :|| s :- |]')).toEqual([1, 2, 1, 2, 3]);
  });
  it('takes 1st and 2nd endings', () => {
    expect(order('||: d :r | m :f | [ending:1] s :- :|| [ending:2] d\' :- |]')).toEqual([1, 2, 3, 1, 2, 4]);
  });
  it('handles multi-bar endings and music after them', () => {
    expect(order('||: d :r | [ending:1] m :f | s :- :|| [ending:2] l :- | t :- [/ending] | d\' :- |]')).toEqual([1, 2, 3, 1, 4, 5, 6]);
  });
  it('handles three times through (endings 1,2 and 3)', () => {
    expect(order('||: d :r | [ending:1,2] m :- :|| [ending:3] s :- |]')).toEqual([1, 2, 1, 2, 1, 3]);
  });
  it('handles two repeat sections one after another', () => {
    expect(order('||: d :r :|| ||: m :f | [ending:1] s :- :|| [ending:2] l :- |]')).toEqual([1, 1, 2, 3, 2, 4]);
  });
  it('D.C. al Fine: back to the start, stop at Fine, no repeats the second time', () => {
    expect(order('||: d :r :|| m :f [fine] || s :l | t :- [D.C. al Fine] |]')).toEqual([1, 1, 2, 3, 4, 1, 2]);
  });
  it('can take repeats again after D.C. if asked', () => {
    expect(order('||: d :r :|| m :f [fine] || s :l | t :- [D.C. al Fine] |]', { repeatsAfterJump: true })).toEqual([1, 1, 2, 3, 4, 1, 1, 2]);
  });
  it('D.S. al Coda: back to the Segno, jump to the Coda at "To Coda"', () => {
    expect(order('| d :r | [segno] m :f | s :l [tocoda] | t :- [D.S. al Coda] || [coda] d\' :- |]')).toEqual([1, 2, 3, 4, 2, 3, 5]);
  });
  it('plays only the last ending after a D.C.', () => {
    expect(order('||: d :r | [ending:1] m :- :|| [ending:2] f :- | s :- [D.C.] |]')).toEqual([1, 2, 1, 3, 4, 1, 3, 4]);
  });
  it('keeps the pickup bar at the start', () => {
    const s = parseSolfa('Key: C\nTime: 2/4\nS: :s, ||: d :r | m :- :|| f :- |]');
    expect(expandPlayOrder(s.measures).steps.map((st) => st.measure)).toEqual([0, 1, 2, 1, 2, 3]);
  });
});

describe('play order description', () => {
  it('describes Evening Song', () => {
    const s = parseSolfa(fixture('evening-song.solfa.txt'));
    const { steps } = expandPlayOrder(s.measures);
    expect(steps.map((x) => x.measure)).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6, 7, 8, 0, 1, 2, 4, 5, 6]);
    expect(describePlayOrder(steps, s.measures)).toEqual([
      'Pickup + bars 1–3 (1st ending)',
      'Repeat: bars 1–2',
      'Bars 4–8 (2nd ending)',
      'D.C. — back to the start: pickup + bars 1–2',
      'Bars 4–6 (2nd ending) — stop at Fine',
    ]);
  });
});
