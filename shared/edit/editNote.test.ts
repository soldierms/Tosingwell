import { describe, expect, it } from 'vitest';
import { editNote, findEvent } from './editNote';
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
