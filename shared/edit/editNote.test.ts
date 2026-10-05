import { describe, expect, it } from 'vitest';
import { editNote, findEvent, solfaNotePitches } from './editNote';
import { parseKey } from '../convert/pitch';
import { parseStaffText } from '../staff/parse';
import { writeStaffText } from '../staff/write';
import { writeSolfa } from '../solfa/write';
import { parseSolfa } from '../solfa/parse';
import { frac } from '../model/fraction';
import { barsOf } from '../../tests/helpers';

const score = () => parseStaffText('Key: G\nTime: 4/4\nS: | G4q{conf=0.5} A4q B4h |\nA: | D4w |');

describe('editing a note in the review screen', () => {
  it('moves a note up a step to the note in the key, and marks it checked', () => {
    const s = editNote(score(), 'S-m0-e0', { type: 'step', delta: -1 });
    const ev = findEvent(s, 'S-m0-e0')!.ev;
    expect(ev.pitches[0]).toEqual({ step: 'F', alter: 1, octave: 4 }); // F# in G major
    expect(ev.confidence).toBe(1);
  });
  it('does not change the original score', () => {
    const s = score();
    editNote(s, 'S-m0-e0', { type: 'octave', delta: 1 });
    expect(findEvent(s, 'S-m0-e0')!.ev.pitches[0].octave).toBe(4);
  });
  it('sets an accidental, a length, a rest, and a tie', () => {
    let s = editNote(score(), 'S-m0-e1', { type: 'accidental', alter: -1 });
    expect(findEvent(s, 'S-m0-e1')!.ev.pitches[0]).toMatchObject({ step: 'A', alter: -1 });
    s = editNote(s, 'S-m0-e2', { type: 'length', duration: frac(1, 4) });
    expect(barsOf(s, 'S')[0]).toBe('G4@0:1/4 Ab4@1/4:1/4 B4@1/2:1/4');
    s = editNote(s, 'S-m0-e2', { type: 'kind', kind: 'rest' });
    expect(findEvent(s, 'S-m0-e2')!.ev.kind).toBe('rest');
    s = editNote(s, 'S-m0-e0', { type: 'tie' });
    expect(findEvent(s, 'S-m0-e0')!.ev.tieToNext).toBe(true);
  });
  it('survives writing back to text in both notations', () => {
    const s = editNote(score(), 'S-m0-e0', { type: 'step', delta: 1 });
    expect(barsOf(parseStaffText(writeStaffText(s).text), 'S')).toEqual(barsOf(s, 'S'));
    expect(barsOf(parseSolfa(writeSolfa(s).text), 'S')).toEqual(barsOf(s, 'S'));
    // The edited note is no longer marked uncertain in the text.
    expect(writeStaffText(s).text).not.toContain('conf=');
  });
  it('deletes a note', () => {
    const s = editNote(score(), 'S-m0-e1', { type: 'delete' });
    expect(barsOf(s, 'S')[0]).toBe('G4@0:1/4 B4@1/4:1/2');
  });
});

describe('editing in sol-fa', () => {
  const kyrie = () => parseSolfa("Key: Bb\nTime: 6/8\nS: | s :s :- ! l :- :- | t :t :- ! d :s :- |\nT: | d :d :- ! d :- :- | t, :t, :- ! d :- :- |");
  it('sets a note by typing its sol-fa, with octave marks', () => {
    const s = editNote(kyrie(), 'S-m1-e2', { type: 'solfa', text: "d'" });
    expect(findEvent(s, 'S-m1-e2')!.ev.pitches[0]).toEqual({ step: 'B', alter: -1, octave: 4 });
    const t = editNote(kyrie(), 'T-m0-e0', { type: 'solfa', text: 'd,' });
    expect(findEvent(t, 'T-m0-e0')!.ev.pitches[0]).toEqual({ step: 'B', alter: -1, octave: 2 });
  });
  it('accepts chromatic notes and two notes together', () => {
    const s = editNote(kyrie(), 'S-m0-e0', { type: 'solfa', text: 'fe' });
    expect(findEvent(s, 'S-m0-e0')!.ev.pitches[0]).toEqual({ step: 'E', alter: 0, octave: 4 });
    const c = editNote(kyrie(), 'S-m0-e0', { type: 'solfa', text: 'm+d' });
    expect(findEvent(c, 'S-m0-e0')!.ev.pitches.length).toBe(2);
  });
  it('explains what is wrong with text that is not a note, and changes nothing', () => {
    const k = parseKey('Bb')!;
    expect(solfaNotePitches('x', k, 3, 'S')).toContain('not one sol-fa note');
    expect(solfaNotePitches('d :r', k, 3, 'S')).toContain('not one sol-fa note');
    const s = kyrie();
    expect(editNote(s, 'S-m0-e0', { type: 'solfa', text: 'zz' })).toBe(s);
  });
  it('replaces a whole bar written in sol-fa, and the staff follows', () => {
    const s = kyrie();
    const text = writeSolfa(s, new Map([['S:1', "t :t :- ! d' :- :-"]])).text;
    const back = parseSolfa(text);
    expect(barsOf(back, 'S')[1]).toBe('A4@0:1/8 A4@1/8:1/4 Bb4@3/8:3/8');
    expect(barsOf(back, 'S')[0]).toEqual(barsOf(s, 'S')[0]);
    expect(barsOf(back, 'T')).toEqual(barsOf(s, 'T'));
    expect(barsOf(parseStaffText(writeStaffText(back).text), 'S')).toEqual(barsOf(back, 'S'));
  });
});
