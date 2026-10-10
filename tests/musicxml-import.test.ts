// MusicXML (as written by Audiveris) → reading → typed staff text → Score.
import { describe, expect, it } from 'vitest';
import { musicXmlToReading } from '../shared/musicxml/import';
import { readingToText } from '../shared/vision/toText';
import { parseStaffText } from '../shared/staff/parse';
import { barsOf, lyricsOf } from './helpers';

const note = (step: string, oct: number, type: string, dur: number, voice: number, staff: number, o: { alter?: number; stem?: string; chord?: boolean; lyric?: string } = {}) =>
  `<note>${o.chord ? '<chord/>' : ''}<pitch><step>${step}</step>${o.alter ? `<alter>${o.alter}</alter>` : ''}<octave>${oct}</octave></pitch>` +
  `<duration>${dur}</duration><voice>${voice}</voice><type>${type}</type>${o.stem ? `<stem>${o.stem}</stem>` : ''}<staff>${staff}</staff>` +
  `${o.lyric ? `<lyric number="1"><syllabic>single</syllabic><text>${o.lyric}</text></lyric>` : ''}</note>`;
const rest = (dur: number, voice: number, staff: number, type = 'half') =>
  `<note><rest/><duration>${dur}</duration><voice>${voice}</voice><type>${type}</type><staff>${staff}</staff></note>`;
const backup = (d: number) => `<backup><duration>${d}</duration></backup>`;

function closed(measures: string[], attrs = '<key><fifths>1</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time>') {
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>2</divisions>${attrs}<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` : ''}${m}</measure>`).join('')}</part></score-partwise>`;
}

const score = (xml: string) => {
  const r = readingToText(musicXmlToReading(xml));
  return { text: r.text, notes: r.notes, score: parseStaffText(r.text) };
};

describe('MusicXML import (Audiveris)', () => {
  it('splits a closed score into S A T B by voice', () => {
    const m1 =
      note('B', 4, 'quarter', 2, 1, 1, { lyric: 'Praise' }) + note('G', 4, 'quarter', 2, 1, 1, { lyric: 'Him' }) + backup(4) +
      note('G', 4, 'quarter', 2, 2, 1) + note('D', 4, 'quarter', 2, 2, 1) + backup(4) +
      note('D', 4, 'half', 4, 5, 2) + backup(4) + note('G', 3, 'half', 4, 6, 2);
    const { score: s, notes } = score(closed([m1]));
    expect(notes.filter((n) => n.level === 'error')).toEqual([]);
    expect(barsOf(s, 'S')).toEqual(['B4@0:1/4 G4@1/4:1/4']);
    expect(barsOf(s, 'A')).toEqual(['G4@0:1/4 D4@1/4:1/4']);
    expect(barsOf(s, 'T')).toEqual(['D4@0:1/2']);
    expect(barsOf(s, 'B')).toEqual(['G3@0:1/2']);
    expect(lyricsOf(s, 'S')).toEqual(['Praise', 'Him']);
  });

  it('gives a lone voice to soprano or alto by stem direction (the other rests)', () => {
    const m1 = note('D', 5, 'half', 4, 1, 1, { stem: 'up' }) + backup(4) + rest(4, 5, 2) + backup(4) + rest(4, 6, 2);
    const m2 = note('F', 4, 'half', 4, 1, 1, { stem: 'down' }) + backup(4) + rest(4, 5, 2) + backup(4) + rest(4, 6, 2);
    const { score: s } = score(closed([m1, m2]));
    expect(barsOf(s, 'S')).toEqual(['D5@0:1/2', 'r@0:1/2']);
    expect(barsOf(s, 'A')).toEqual(['r@0:1/2', 'F4@0:1/2']);
  });

  it('writes out accidentals so the key signature does not change them (G major: F is F#)', () => {
    const m1 =
      note('F', 4, 'quarter', 2, 1, 1) + note('F', 4, 'quarter', 2, 1, 1, { alter: 0 }) + backup(4) +
      note('D', 4, 'half', 4, 2, 1) + backup(4) + note('B', 3, 'half', 4, 5, 2) + backup(4) + note('G', 3, 'half', 4, 6, 2);
    // MusicXML gives real pitches: first F has no <alter> → F natural in G major, so it must be written "Fn".
    const { score: s } = score(closed([m1]));
    expect(barsOf(s, 'S')).toEqual(['F4@0:1/4 F4@1/4:1/4']);
  });

  it('works out a missing time signature from the bars', () => {
    const bar = note('B', 4, 'quarter', 2, 1, 1, { stem: 'up' }) + note('B', 4, 'eighth', 1, 1, 1, { stem: 'up' }) +
      note('B', 4, 'quarter', 2, 1, 1, { stem: 'up' }) + note('B', 4, 'eighth', 1, 1, 1, { stem: 'up' });
    const xml = closed([bar, bar, bar], '<key><fifths>-2</fifths></key>').replace(/<staves>2<\/staves>/, '<staves>1</staves>');
    const r = musicXmlToReading(xml);
    expect(r.time).toBe('6/8'); // quarter + eighth, twice: two dotted-quarter beats
    expect(r.questions.join(' ')).toMatch(/No time signature/);
    const waltz = note('B', 4, 'quarter', 2, 1, 1, { stem: 'up' }).repeat(3);
    const xml2 = closed([waltz, waltz, waltz], '<key><fifths>-2</fifths></key>').replace(/<staves>2<\/staves>/, '<staves>1</staves>');
    expect(musicXmlToReading(xml2).time).toBe('3/4');
  });

  it('puts plain text under the staff onto the notes as lyrics', () => {
    const words = `<direction placement="below"><direction-type><words default-y="-40">give him your</words></direction-type><staff>1</staff></direction>`;
    const m1 = words + note('D', 5, 'eighth', 1, 1, 1) + note('D', 5, 'eighth', 1, 1, 1) + note('D', 5, 'quarter', 2, 1, 1) + backup(4) +
      rest(4, 5, 2);
    const xml = closed([m1]);
    const { score: s } = score(xml);
    expect(lyricsOf(s, 'S')).toEqual(['give', 'him', 'your']);
  });

  it('leaves out a piano part below single-staff voice parts', () => {
    const part = (id: string, clef: string, step: string, oct: number, staves = 1) =>
      `<part id="${id}"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>1</beats><beat-type>4</beat-type></time><staves>${staves}</staves><clef><sign>${clef}</sign></clef></attributes>${note(step, oct, 'quarter', 1, 1, 1)}</measure></part>`;
    const ids = ['P1', 'P2', 'P3', 'P4', 'P5'];
    const xml = `<score-partwise><part-list>${ids.map((i) => `<score-part id="${i}"><part-name>Voice</part-name></score-part>`).join('')}</part-list>
      ${part('P1', 'G', 'E', 5)}${part('P2', 'G', 'C', 5)}${part('P3', 'G', 'G', 4)}${part('P4', 'F', 'C', 3)}${part('P5', 'G', 'C', 6, 2)}</score-partwise>`;
    const { score: s, notes } = score(xml);
    expect(barsOf(s, 'S')).toEqual(['E5@0:1/4']);
    expect(barsOf(s, 'B')).toEqual(['C3@0:1/4']);
    expect(notes.map((n) => n.message).join(' ')).toMatch(/piano/i);
  });
});

describe('adding a page with a different key or time', () => {
  it('starts the page with [key:…]/[time:…] only when they change', async () => {
    const { continuePage } = await import('../shared/vision/toText');
    const { parseKey } = await import('../shared/convert/pitch');
    const bar = { number: 1, events: [], solfa: null, solfaLyrics: null, repeatStart: false, repeatEnd: false, endBarline: 'single' as const, directives: [], unreadable: false, problem: null, region: null, confidence: 1 };
    const page = { notation: 'staff' as const, title: null, composer: null, key: 'G', time: '3/4', tempo: null, parts: [{ voice: 'S' as const, clef: 'treble' as const, bars: [bar] }], questions: [], photoProblems: [] };
    const now = { key: parseKey('Bb')!, time: { beats: 6, beatType: 8 } };
    expect(continuePage(page, now).parts[0].bars[0].directives).toEqual(['key:G', 'time:3/4']);
    expect(continuePage({ ...page, key: 'Bb', time: '6/8' }, now).parts[0].bars[0].directives).toEqual([]);
  });
});

describe('ties in playback', () => {
  it('re-sings a note after a tie ends, even on the same pitch', async () => {
    const { parseStaffText } = await import('../shared/staff/parse');
    const { expandPlayOrder } = await import('../shared/playback/expand');
    const { buildSchedule } = await import('../shared/playback/schedule');
    const s = parseStaffText('Key: Bb   Time: 2/4\nS: | rq rq G4e~ | G4s G4e.~ G4q |\n');
    const sch = buildSchedule(s, expandPlayOrder(s.measures).steps, { speed: 1 });
    expect(sch.notes.filter((n) => !n.rest && n.midi.length).length).toBe(2); // "mmɔ" (tied) and "bɔ'o" (tied)
  });
});
