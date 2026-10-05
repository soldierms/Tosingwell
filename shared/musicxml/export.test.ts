import { describe, expect, it } from 'vitest';
import { exportMusicXml } from './export';
import { parseSolfa } from '../solfa/parse';
import { parseStaffText } from '../staff/parse';
import { barLength } from '../textinput/common';
import { toNumber } from '../model/fraction';
import { fixture } from '../../tests/helpers';
import type { Score } from '../model/types';

/** Every opened tag is closed in the right order (well-formed XML). */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

const parts = (xml: string) => [...xml.matchAll(/<part id="(P\w)">([\s\S]*?)<\/part>/g)].map((m) => ({ id: m[1], body: m[2] }));
const measures = (part: string) => [...part.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[2]);
const divisions = (xml: string) => Number(/<divisions>(\d+)<\/divisions>/.exec(xml)![1]);

/** Total sounding length of a measure (chord and grace notes don't add time). */
function measureDuration(m: string): number {
  let total = 0;
  for (const n of m.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
    if (n[1].includes('<chord/>') || n[1].includes('<grace')) continue;
    total += Number(/<duration>(\d+)<\/duration>/.exec(n[1])?.[1] ?? 0);
  }
  return total;
}

function expectBarsAddUp(score: Score, xml: string) {
  const div = divisions(xml);
  for (const p of parts(xml)) {
    measures(p.body).forEach((m, i) => {
      if (score.measures[i].pickup) return;
      expect(measureDuration(m), `${p.id} bar ${i}`).toBe(toNumber(barLength(score.measures[i].time)) * 4 * div);
    });
  }
}

describe('MusicXML export', () => {
  for (const name of ['old-hundredth.solfa.txt', 'evening-song.solfa.txt', 'evening-song.staff.txt']) {
    it(`writes well-formed MusicXML whose bars add up: ${name}`, () => {
      const score = name.includes('solfa') ? parseSolfa(fixture(name)) : parseStaffText(fixture(name));
      const xml = exportMusicXml(score);
      expect(wellFormed(xml)).toBe(true);
      expect(parts(xml).map((p) => p.id)).toEqual(['PS', 'PA', 'PT', 'PB']);
      for (const p of parts(xml)) expect(measures(p.body).length).toBe(score.measures.length);
      expectBarsAddUp(score, xml);
    });
  }

  it('writes key, time, clefs, tempo, title and composer', () => {
    const xml = exportMusicXml(parseSolfa(fixture('evening-song.solfa.txt')), { tenorClef: 'treble8vb' });
    expect(xml).toContain('<work-title>Evening Song (test piece)</work-title>');
    expect(xml).toContain('<creator type="composer">Tosingwell test library</creator>');
    expect(xml).toContain('<fifths>2</fifths>');
    expect(xml).toContain('<beats>3</beats><beat-type>4</beat-type>');
    expect(xml).toContain('<clef-octave-change>-1</clef-octave-change>');
    expect(xml).toContain('<sound tempo="88"/>');
    expect(xml).toContain('<measure number="0" implicit="yes">');
  });

  it('writes repeats, endings, Fine and D.C.', () => {
    const xml = exportMusicXml(parseSolfa(fixture('evening-song.solfa.txt')));
    const sop = parts(xml)[0].body;
    expect(sop).toContain('<repeat direction="forward"/>');
    expect(sop).toContain('<repeat direction="backward"/>');
    expect(sop).toContain('<ending number="1" type="start">');
    expect(sop).toContain('<ending number="2" type="start">');
    expect(sop).toContain('<sound fine="yes"/>');
    expect(sop).toContain('<sound dacapo="yes"/>');
    expect(sop).toContain('rit.');
  });

  it('writes pitches, accidentals as printed, ties, tuplets, lyrics and marks', () => {
    const score = parseStaffText('Title: T\nKey: G\nTime: 2/4\nS: | F4q{p} F#4q{stacc} | (3 C5e~ C5e D5e) Bb4q{ferm} | C5h.~ | C5q rq |\nS-lyrics: A-bide with _ me now');
    const xml = exportMusicXml(score);
    expect(wellFormed(xml)).toBe(true);
    // F is sharp from the key signature: no accidental printed on the first two notes.
    const first = /<note>.*?<\/note>/.exec(xml)![0];
    expect(first).toContain('<step>F</step><alter>1</alter>');
    expect(first).not.toContain('<accidental>');
    expect(xml).toContain('<accidental>flat</accidental>');
    expect(xml).toContain('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<dynamics><p/></dynamics>');
    expect(xml).toContain('<staccato/>');
    expect(xml).toContain('<fermata type="upright"/>');
    expect(xml).toContain('<syllabic>begin</syllabic><text>A</text>');
    expect(xml).toContain('<extend/>');
  });

  it('splits lengths that need a tie (a 3/4 bar note in sol-fa → dotted half)', () => {
    const xml = exportMusicXml(parseSolfa('Key: C\nTime: 5/4\nS: | d :- :- :- :- |'));
    expect(xml).toMatch(/<type>whole<\/type>[\s\S]*<type>quarter<\/type>/);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
  });

  it('escapes special characters in titles and lyrics', () => {
    const xml = exportMusicXml(parseSolfa('Title: Rock & Roll <test>\nKey: C\nTime: 2/4\nS: | d :r |\nS-lyrics: "O" &'));
    expect(xml).toContain('Rock &amp; Roll &lt;test&gt;');
    expect(wellFormed(xml)).toBe(true);
  });
});
