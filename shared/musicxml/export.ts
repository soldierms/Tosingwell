// Score → MusicXML 4.0 (partwise), so scores open in MuseScore, Finale,
// Sibelius, Dorico and other notation programs.
//
// Each voice (S, A, T, B) becomes its own part on its own staff — the most
// widely compatible layout. Everything in the model is written: key, time,
// clef, tempo, notes/rests with exact lengths, ties, tuplets, grace notes,
// accidentals as printed, dynamics, hairpins, articulations, fermatas, slurs,
// lyrics (with hyphens and melismas), repeats, endings, segno/coda/fine,
// D.C./D.S., rit./accel., key and time changes, pickup bar.

import { div, frac, mul, toNumber, type Frac } from '../model/fraction';
import type { Clef, Dynamic, MeasureInfo, NoteEvent, Part, Score } from '../model/types';
import { eventStarts, keyAt, tiedIntoBar } from '../model/score';
import { keyFifths } from '../convert/pitch';
import { notate, type Notated } from '../convert/duration';
import { accidentalShower } from '../convert/accidentals';
import { tempoValue } from '../playback/schedule';

export interface MusicXmlOptions {
  tenorClef?: 'bass' | 'treble8vb';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TYPE: Record<number, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const ACC_NAME: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const ARTIC: Record<string, string> = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', marcato: 'strong-accent' };

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** Divisions per quarter note so every length is a whole number. */
function divisionsFor(score: Score): number {
  let d = 1;
  for (const p of score.parts) for (const m of p.measures) for (const e of m.events) {
    const q = mul(e.duration, frac(4)); // length in quarters
    d = lcm(d, q.d);
    if (e.tuplet) d = lcm(d, e.tuplet.actual);
  }
  return Math.min(d, 960 * 8);
}

function clefXml(c: Clef): string {
  if (c === 'bass') return '<clef><sign>F</sign><line>4</line></clef>';
  if (c === 'treble8vb') return '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
  return '<clef><sign>G</sign><line>2</line></clef>';
}

const partClef = (p: Part, opts: MusicXmlOptions): Clef =>
  p.id === 'S' || p.id === 'A' ? 'treble' : p.id === 'B' ? 'bass' : opts.tenorClef === 'treble8vb' ? 'treble8vb' : 'bass';

function words(text: string, placement: 'above' | 'below' = 'above', extra = '') {
  return `<direction placement="${placement}"><direction-type><words>${esc(text)}</words></direction-type>${extra}</direction>`;
}

export function exportMusicXml(score: Score, opts: MusicXmlOptions = {}): string {
  const divisions = divisionsFor(score);
  const dur = (f: Frac) => Math.round(toNumber(f) * 4 * divisions);
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(score.meta.title)}</work-title></work>`);
  out.push('<identification>');
  if (score.meta.composer) out.push(`<creator type="composer">${esc(score.meta.composer)}</creator>`);
  if (score.meta.arranger) out.push(`<creator type="arranger">${esc(score.meta.arranger)}</creator>`);
  out.push('<encoding><software>Tosingwell</software></encoding></identification>');
  out.push('<part-list>');
  for (const p of score.parts) out.push(`<score-part id="P${p.id}"><part-name>${esc(p.name)}</part-name><part-abbreviation>${p.id}.</part-abbreviation></score-part>`);
  out.push('</part-list>');

  score.parts.forEach((part, pi) => {
    const isTop = pi === 0; // bar-level words (D.C., tempo…) are written once, in the top part
    const clef = partClef(part, opts);
    out.push(`<part id="P${part.id}">`);
    let prevKeyEnd = score.measures[0]?.key;
    part.measures.forEach((pm, b) => {
      const m = score.measures[b];
      if (!m) return;
      out.push(`<measure number="${m.number}"${m.pickup ? ' implicit="yes"' : ''}>`);

      // Bar start: repeat sign / ending.
      if (m.repeatStart || m.ending?.start) {
        out.push('<barline location="left">');
        if (m.ending?.start) out.push(`<ending number="${m.ending.numbers.join(', ')}" type="start">${m.ending.numbers.join(', ')}.</ending>`);
        if (m.repeatStart) out.push('<bar-style>heavy-light</bar-style><repeat direction="forward"/>');
        out.push('</barline>');
      }

      // Attributes at the first bar, and when key/time change at the bar line.
      const keyChangedAtStart = b > 0 && prevKeyEnd && keyFifths(prevKeyEnd) !== keyFifths(m.key);
      if (b === 0 || m.timeChanged || keyChangedAtStart) {
        out.push('<attributes>');
        if (b === 0) out.push(`<divisions>${divisions}</divisions>`);
        if (b === 0 || keyChangedAtStart) out.push(`<key><fifths>${keyFifths(m.key)}</fifths><mode>${m.key.mode}</mode></key>`);
        if (b === 0 || m.timeChanged) out.push(`<time><beats>${m.time.beats}</beats><beat-type>${m.time.beatType}</beat-type></time>`);
        if (b === 0) out.push(clefXml(clef));
        out.push('</attributes>');
      }
      prevKeyEnd = m.keyChanges?.length ? m.keyChanges[m.keyChanges.length - 1].key : m.key;

      if (isTop) out.push(...barStartDirections(m));

      const starts = eventStarts(pm.events);
      const show = accidentalShower();
      let prevNote: NoteEvent | undefined = tiedIntoBar(part, b);
      const usedOffsets: Frac[] = [];
      pm.events.forEach((ev, k) => {
        const at = starts[k];
        // Mid-bar key changes (sol-fa modulations) and rit./accel.
        for (const kc of m.keyChanges ?? []) {
          if (kc.offset.n !== 0 && toNumber(kc.offset) === toNumber(at) && !usedOffsets.some((u) => toNumber(u) === toNumber(at))) {
            out.push(`<attributes><key><fifths>${keyFifths(kc.key)}</fifths><mode>${kc.key.mode}</mode></key></attributes>`);
          }
        }
        if (isTop) {
          for (const tc of m.tempoChanges ?? []) {
            if (toNumber(tc.offset) === toNumber(at) && !usedOffsets.some((u) => toNumber(u) === toNumber(at))) {
              out.push(words(tc.kind === 'rit' ? 'rit.' : tc.kind === 'accel' ? 'accel.' : 'a tempo'));
            }
          }
        }
        usedOffsets.push(at);
        if (ev.dynamic) out.push(dynamicXml(ev.dynamic));
        if (ev.hairpin) out.push(`<direction placement="below"><direction-type><wedge type="${ev.hairpin === 'cresc' ? 'crescendo' : ev.hairpin === 'dim' ? 'diminuendo' : 'stop'}"/></direction-type></direction>`);
        if (ev.pedal) out.push(`<direction placement="below"><direction-type><pedal type="${ev.pedal === 'down' ? 'start' : 'stop'}"/></direction-type></direction>`);

        const key = keyAt(m, at);
        const accs = show({ pitches: ev.pitches, key, tiedFrom: prevNote?.tieToNext ? prevNote.pitches : undefined });
        const tiedIn = !!prevNote?.tieToNext && ev.kind === 'note';
        out.push(...noteXml(ev, accs, tiedIn, dur));
        if (!ev.grace) prevNote = ev.kind === 'note' ? ev : undefined;
      });

      if (isTop) out.push(...barEndDirections(m));
      // Bar end: repeat sign / ending / final bar.
      const last = b === score.measures.length - 1;
      if (m.repeatEnd || m.ending?.end || m.finalBar || m.doubleBar || last) {
        out.push('<barline location="right">');
        out.push(`<bar-style>${m.repeatEnd || m.finalBar || last ? 'light-heavy' : 'light-light'}</bar-style>`);
        if (m.ending?.end) out.push(`<ending number="${m.ending.numbers.join(', ')}" type="${m.repeatEnd ? 'stop' : 'discontinue'}"/>`);
        if (m.repeatEnd) out.push('<repeat direction="backward"/>');
        out.push('</barline>');
      }
      out.push('</measure>');
    });
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n') + '\n';
}

function dynamicXml(d: Dynamic) {
  return `<direction placement="below"><direction-type><dynamics><${d}/></dynamics></direction-type></direction>`;
}

function barStartDirections(m: MeasureInfo): string[] {
  const out: string[] = [];
  if (m.tempo) {
    const tv = tempoValue(m.tempo);
    const unit = notate(m.tempo.beatUnit ?? frac(1, 4))?.[0];
    const metro = m.tempo.bpm && unit
      ? `<direction-type><metronome><beat-unit>${TYPE[unit.base]}</beat-unit>${unit.dots ? '<beat-unit-dot/>' : ''}<per-minute>${m.tempo.bpm}</per-minute></metronome></direction-type>`
      : '';
    const text = m.tempo.text ? `<direction-type><words font-weight="bold">${esc(m.tempo.text)}</words></direction-type>` : '';
    // <sound tempo> is in quarter notes per minute.
    const qpm = Math.round(tv.bpm * toNumber(div(tv.unit, frac(1, 4))) * 100) / 100;
    out.push(`<direction placement="above">${text}${metro}<sound tempo="${qpm}"/></direction>`);
  }
  if (m.segno) out.push('<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>');
  if (m.coda) out.push('<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>');
  return out;
}

function barEndDirections(m: MeasureInfo): string[] {
  const out: string[] = [];
  if (m.fine) out.push(words('Fine', 'above', '<sound fine="yes"/>'));
  if (m.toCoda) out.push(words('To Coda', 'above', '<sound tocoda="coda"/>'));
  if (m.jump) {
    const sound = m.jump.startsWith('D.C.') ? '<sound dacapo="yes"/>' : '<sound dalsegno="segno"/>';
    out.push(words(m.jump, 'above', sound));
  }
  return out;
}

function noteXml(ev: NoteEvent, accs: (number | undefined)[], tiedIn: boolean, dur: (f: Frac) => number): string[] {
  const out: string[] = [];
  const writtenLen = ev.tuplet ? mul(ev.duration, frac(ev.tuplet.actual, ev.tuplet.normal)) : ev.duration;
  const pieces: Notated[] = notate(writtenLen) ?? [{ base: 4, dots: 0 }];
  const piecesSounding = pieces.map((p) => {
    const len = frac(1, p.base);
    const withDots = p.dots === 0 ? len : p.dots === 1 ? mul(len, frac(3, 2)) : mul(len, frac(7, 4));
    return ev.tuplet ? mul(withDots, frac(ev.tuplet.normal, ev.tuplet.actual)) : withDots;
  });

  pieces.forEach((piece, i) => {
    const first = i === 0;
    const lastPiece = i === pieces.length - 1;
    const tieStart = ev.kind === 'note' && (!lastPiece || !!ev.tieToNext);
    const tieStop = ev.kind === 'note' && (!first || tiedIn);
    const heads = ev.kind === 'rest' ? [undefined] : ev.pitches;
    heads.forEach((p, j) => {
      const x: string[] = ['<note>'];
      if (ev.grace) x.push('<grace slash="yes"/>');
      if (j > 0) x.push('<chord/>');
      if (!p) x.push('<rest/>');
      else x.push(`<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`);
      if (!ev.grace) x.push(`<duration>${dur(piecesSounding[i])}</duration>`);
      if (tieStop) x.push('<tie type="stop"/>');
      if (tieStart) x.push('<tie type="start"/>');
      x.push(`<voice>1</voice><type>${TYPE[piece.base]}</type>`);
      for (let d = 0; d < piece.dots; d++) x.push('<dot/>');
      const acc = p && first ? accs[j] : undefined;
      if (acc !== undefined) x.push(`<accidental>${ACC_NAME[acc]}</accidental>`);
      if (ev.tuplet) x.push(`<time-modification><actual-notes>${ev.tuplet.actual}</actual-notes><normal-notes>${ev.tuplet.normal}</normal-notes></time-modification>`);

      const nots: string[] = [];
      if (tieStop) nots.push('<tied type="stop"/>');
      if (tieStart) nots.push('<tied type="start"/>');
      if (j === 0 && first) {
        if (ev.slurStart) nots.push('<slur type="start" number="1"/>');
        if (ev.articulations?.length) nots.push(`<articulations>${ev.articulations.map((a) => `<${ARTIC[a]}/>`).join('')}</articulations>`);
        if (ev.fermata) nots.push('<fermata type="upright"/>');
      }
      if (j === 0 && lastPiece && ev.slurEnd) nots.push('<slur type="stop" number="1"/>');
      if (nots.length) x.push(`<notations>${nots.join('')}</notations>`);

      if (j === 0 && first) {
        for (const l of ev.lyrics ?? []) {
          x.push(`<lyric number="${l.verse}"><syllabic>${l.syllabic}</syllabic><text>${esc(l.text)}</text>${l.extend ? '<extend/>' : ''}</lyric>`);
        }
      }
      x.push('</note>');
      out.push(x.join(''));
    });
  });
  return out;
}
