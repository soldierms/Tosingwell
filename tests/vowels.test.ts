// The singing voice: which vowel each syllable is sung on, and that melismas keep the vowel.
import { describe, expect, it } from 'vitest';
import { expandPlayOrder } from '../shared/playback/expand';
import { buildSchedule } from '../shared/playback/schedule';
import { singingSounds, syllableSound } from '../shared/playback/vowels';
import { parseStaffText } from '../shared/staff/parse';

describe('syllableSound', () => {
  it('finds the vowel and how the syllable starts', () => {
    expect(syllableSound('Nya')).toEqual({ vowel: 'a', onset: 'nasal' });
    expect(syllableSound('hyɛ')).toEqual({ vowel: 'ɛ', onset: 'breath' });
    expect(syllableSound('krɔn')).toEqual({ vowel: 'ɔ', onset: 'voiced' });
    expect(syllableSound('E')).toEqual({ vowel: 'e', onset: 'none' });
    expect(syllableSound("W'E")).toEqual({ vowel: 'e', onset: 'voiced' });
    expect(syllableSound('yie!')).toEqual({ vowel: 'i', onset: 'voiced' });
    expect(syllableSound('N')).toEqual({ vowel: 'm', onset: 'none' });
    expect(syllableSound('see')).toEqual({ vowel: 'i', onset: 'breath' });
    expect(syllableSound('Ɔ')).toEqual({ vowel: 'ɔ', onset: 'none' });
    expect(syllableSound(',')).toBeUndefined();
  });
});

describe('singingSounds', () => {
  it('sings each note on its word, keeps the vowel over a melisma, and "ah" without words', () => {
    const score = parseStaffText(`Key: C\nTime: 4/4\nS: | C4q D4q~ D4q E4q |\nA: | C4h C4h |\nS-lyrics: Nya- me _ yie!`);
    const { steps } = expandPlayOrder(score.measures, { repeatsAfterJump: false });
    const notes = buildSchedule(score, steps).notes;
    const sounds = singingSounds(notes);
    const sop = notes.filter((n) => n.part === 'S' && sounds.has(n)).map((n) => sounds.get(n)!.vowel);
    expect(sop).toEqual(['a', 'e', 'e']);
    const alto = notes.filter((n) => n.part === 'A' && sounds.has(n)).map((n) => sounds.get(n)!.vowel);
    expect(alto).toEqual(['a', 'a']);
  });
});
