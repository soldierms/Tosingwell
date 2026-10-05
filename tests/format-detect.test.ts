import { describe, expect, it } from 'vitest';
import { looksLike } from '../app/src/storage/library';
import { fixture } from './helpers';

describe('noticing which notation the text is in', () => {
  it('recognises the test scores', () => {
    expect(looksLike(fixture('old-hundredth.solfa.txt'))).toBe('solfa');
    expect(looksLike(fixture('evening-song.solfa.txt'))).toBe('solfa');
    expect(looksLike(fixture('old-hundredth.staff.txt'))).toBe('staff');
    expect(looksLike(fixture('evening-song.staff.txt'))).toBe('staff');
  });
  it('recognises a photo reading in sol-fa with "!" marks and empty pulses', () => {
    expect(looksLike('Key: Bb\nS: | s : s : - | l : - : - ! t : t : - | d : s : - ! s : - : - | : : ! : : |')).toBe('solfa');
  });
  it('does not guess when there is too little to go on', () => {
    expect(looksLike('Title: x\nKey: C')).toBeUndefined();
    expect(looksLike('S: | d |')).toBeUndefined();
  });
});
