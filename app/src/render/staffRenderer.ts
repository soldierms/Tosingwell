// Draws a Score as staff notation (SVG) using VexFlow.
//
// Layout rules (from CLAUDE.md): bars are never split across lines; lines
// break only at bar lines; output is SVG so it prints sharply.

import {
  Accidental,
  Articulation,
  BarlineType,
  Beam,
  Curve,
  Dot,
  Formatter,
  Fraction,
  GraceNote,
  GraceNoteGroup,
  ModifierPosition,
  Renderer,
  Repetition,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Tuplet,
  Voice,
  VoiceMode,
  VoltaType,
  type RenderContext,
} from 'vexflow/bravura';
import { eq, frac, mul, type Frac } from '../../../shared/model/fraction';
import type { Clef, MeasureInfo, NoteEvent, Part, Pitch, Score, VoiceId } from '../../../shared/model/types';
import { eventStarts, keyAt, tiedIntoBar } from '../../../shared/model/score';
import { notate, type Notated } from '../../../shared/convert/duration';
import { accidentalShower } from '../../../shared/convert/accidentals';
import { sameKey, vexKeyName } from '../../../shared/convert/pitch';
import { barLength } from '../../../shared/textinput/common';
import { LOW_CONFIDENCE } from '../../../shared/analysis/checks';

export interface StaffRenderOptions {
  width: number;
  tenorClef: 'bass' | 'treble8vb';
  /** Bars (0-based) to tint red because a check found a problem. */
  flaggedBars?: Set<number>;
  /** Only draw these parts (all if not given). */
  parts?: VoiceId[];
  /** Printing: pure black on white (no colours for uncertain notes). */
  plain?: boolean;
}

export interface StaffRenderResult {
  height: number;
  /** SVG elements for each note event id (for highlighting / clicking). */
  noteElements: Map<string, SVGElement>;
  /** Top and bottom (px) of each line of music, so pages can break between lines. */
  systems: { top: number; bottom: number }[];
  svg?: SVGSVGElement;
}

interface StaffDef {
  clef: Clef;
  parts: Part[];
}

const LEFT = 46; // room for part labels
const RIGHT = 8;
const VEX_ACC: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: 'n', 1: '#', 2: '##' };
const VEX_DUR: Record<number, string> = { 1: 'w', 2: 'h', 4: 'q', 8: '8', 16: '16', 32: '32' };
const ARTIC_CODE = { staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^' } as const;
const REPETITION: Record<string, number> = {
  'D.C.': Repetition.type.DC,
  'D.C. al Fine': Repetition.type.DC_AL_FINE,
  'D.C. al Coda': Repetition.type.DC_AL_CODA,
  'D.S.': Repetition.type.DS,
  'D.S. al Fine': Repetition.type.DS_AL_FINE,
  'D.S. al Coda': Repetition.type.DS_AL_CODA,
};

export function staffDefs(score: Score, tenorClef: StaffRenderOptions['tenorClef'], only?: VoiceId[]): StaffDef[] {
  const has = (v: VoiceId) => score.parts.find((p) => p.id === v && (!only || only.includes(v)));
  const pick = (...vs: VoiceId[]) => vs.map(has).filter((p): p is Part => !!p);
  const defs: StaffDef[] =
    tenorClef === 'bass'
      ? [{ clef: 'treble', parts: pick('S', 'A') }, { clef: 'bass', parts: pick('T', 'B') }]
      : [{ clef: 'treble', parts: pick('S', 'A') }, { clef: 'treble8vb', parts: pick('T') }, { clef: 'bass', parts: pick('B') }];
  return defs.filter((d) => d.parts.length);
}

const vexClef = (c: Clef) => (c === 'bass' ? 'bass' : 'treble');
const vexKey = (p: Pitch, c: Clef) => `${p.step.toLowerCase()}/${p.octave + (c === 'treble8vb' ? 1 : 0)}`;
function restKey(c: Clef, stem: 'up' | 'down' | 'auto') {
  if (c === 'bass') return stem === 'up' ? 'g/3' : stem === 'down' ? 'a/2' : 'd/3';
  return stem === 'up' ? 'e/5' : stem === 'down' ? 'f/4' : 'b/4';
}

/** Diatonic position (C0 = 0) of a pitch as drawn on this clef. */
const staffStep = (p: Pitch, c: Clef) => (p.octave + (c === 'treble8vb' ? 1 : 0)) * 7 + 'CDEFGAB'.indexOf(p.step);
const TOP_LINE: Record<Clef, number> = { treble: 38, treble8vb: 38, bass: 26 }; // F5 / A3
const BOTTOM_LINE: Record<Clef, number> = { treble: 30, treble8vb: 30, bass: 18 }; // E4 / G2

/** How far (px) the notes and stems of a staff reach above its top line and below its bottom line. */
function staffExtent(d: StaffDef, bars: number[]): { above: number; below: number } {
  let above = 0;
  let below = 0;
  const shared = d.parts.length > 1;
  for (const part of d.parts) {
    for (const b of bars) {
      for (const ev of part.measures[b]?.events ?? []) {
        for (const p of ev.pitches) {
          const st = staffStep(p, d.clef);
          const mid = (TOP_LINE[d.clef] + BOTTOM_LINE[d.clef]) / 2;
          const stemUp = shared ? part.stem === 'up' : st < mid;
          const stem = ev.duration.n / ev.duration.d >= 1 ? 6 : 35; // whole notes have no stem
          above = Math.max(above, (st - TOP_LINE[d.clef]) * 5 + (stemUp ? stem : 6));
          below = Math.max(below, (BOTTOM_LINE[d.clef] - st) * 5 + (stemUp ? 6 : stem));
        }
      }
    }
  }
  return { above: Math.max(0, above), below: Math.max(0, below) };
}

/** Rough width a bar needs, before stretching to fill the line. */
function estimateBarWidth(score: Score, b: number): number {
  const PIECE: Record<number, number> = { 1: 38, 2: 32, 4: 28, 8: 24, 16: 22, 32: 20 };
  let best = 0;
  for (const part of score.parts) {
    const pm = part.measures[b];
    if (!pm) continue;
    let w = 0;
    for (const ev of pm.events) {
      const pieces = notate(written(ev)) ?? [{ base: 4, dots: 0 } as Notated];
      for (const p of pieces) w += (ev.grace ? 14 : PIECE[p.base]) + (p.dots ? 6 : 0) + (ev.pitches.some((x) => x.alter !== 0) ? 10 : 0);
      const lyric = ev.lyrics?.reduce((a, l) => Math.max(a, l.text.length), 0) ?? 0;
      w += Math.max(0, lyric * 7.5 - PIECE[pieces[0].base]);
    }
    best = Math.max(best, w);
  }
  return Math.max(80, best + 30);
}

const written = (ev: NoteEvent): Frac => (ev.tuplet ? mul(ev.duration, frac(ev.tuplet.actual, ev.tuplet.normal)) : ev.duration);

function startExtra(m: MeasureInfo, showTime: boolean) {
  return 40 + Math.abs(fifthsOf(m)) * 10 + (showTime ? 26 : 0);
}
function fifthsOf(m: MeasureInfo) {
  const f: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 };
  return f[m.key.doh.step] + 7 * m.key.doh.alter;
}

/** Split bars into lines (systems), never splitting a bar. */
function layoutSystems(score: Score, width: number): { bars: number[]; widths: number[] }[] {
  const avail = width - LEFT - RIGHT;
  const systems: { bars: number[]; widths: number[] }[] = [];
  let cur: { bars: number[]; widths: number[] } = { bars: [], widths: [] };
  let used = 0;
  score.measures.forEach((m, b) => {
    const base = estimateBarWidth(score, b);
    const first = cur.bars.length === 0;
    const w = base + (first ? startExtra(m, b === 0 || !!m.timeChanged) : m.timeChanged ? 26 : 0);
    if (!first && used + w > avail) {
      systems.push(cur);
      cur = { bars: [], widths: [] };
      used = 0;
      const w2 = base + startExtra(m, b === 0 || !!m.timeChanged);
      cur.bars.push(b);
      cur.widths.push(w2);
      used = w2;
      return;
    }
    cur.bars.push(b);
    cur.widths.push(w);
    used += w;
  });
  if (cur.bars.length) systems.push(cur);
  // Stretch each line to the full width (the last line only if it is fairly full).
  systems.forEach((s, i) => {
    const total = s.widths.reduce((a, b) => a + b, 0);
    if (i === systems.length - 1 && systems.length > 1 && total < avail * 0.6) return;
    const k = Math.min(avail / total, 3);
    s.widths = s.widths.map((w) => w * k);
  });
  return systems;
}

interface Drawn {
  ev: NoteEvent;
  part: Part;
  first: StaveNote;
  last: StaveNote;
  stave: Stave;
}

export function renderStaff(container: HTMLElement, score: Score, opts: StaffRenderOptions): StaffRenderResult {
  container.innerHTML = '';
  const noteElements = new Map<string, SVGElement>();
  const defs = staffDefs(score, opts.tenorClef, opts.parts);
  if (!defs.length || !score.measures.length) return { height: 0, noteElements, systems: [] };

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
  const systems = layoutSystems(score, opts.width);

  // Vertical spacing, worked out per line of music: how far notes and stems
  // reach above and below each staff, plus room for lyrics.
  const versesOn = (d: StaffDef) =>
    d.parts.reduce((n, p) => {
      const vs = new Set<number>();
      for (const m of p.measures) for (const e of m.events) for (const l of e.lyrics ?? []) vs.add(l.verse);
      return n + vs.size;
    }, 0);
  const lyricLines = defs.map(versesOn);
  const STAFF_H = 40;
  const ABOVE_TOP = 46; // tempo marks, endings, D.C. text above the first staff
  const layoutY = systems.map((sys) => {
    const ext = defs.map((d) => staffExtent(d, sys.bars));
    const staffY: number[] = [];
    let y = ABOVE_TOP + ext[0].above; // top line of the first staff
    defs.forEach((_d, i) => {
      staffY.push(y - 40); // VexFlow puts the top line 40px below the stave's y
      if (i < defs.length - 1) y += STAFF_H + ext[i].below + lyricLines[i] * 18 + 18 + ext[i + 1].above;
    });
    const last = defs.length - 1;
    const height = y + STAFF_H + ext[last].below + lyricLines[last] * 18 + 22;
    return { staffY, height };
  });
  const tops: number[] = [];
  let acc = 0;
  for (const l of layoutY) {
    tops.push(acc);
    acc += l.height;
  }
  const height = acc + 10;
  renderer.resize(opts.width, height);
  const ctx = renderer.getContext();
  ctx.setFont('Academico', 12);

  // State that continues from bar to bar.
  const lastDrawn = new Map<VoiceId, { note: StaveNote; system: number }>(); // for ties across bars
  const slurStart = new Map<VoiceId, StaveNote>();
  const hairpinStart = new Map<VoiceId, { x: number; kind: 'cresc' | 'dim'; y: number }>();
  let prevStartKey = score.measures[0].key;

  systems.forEach((sys, si) => {
    const top = tops[si];
    const staffY = layoutY[si].staffY.map((y) => y + top);
    let x = LEFT;
    const drawnInSystem: Drawn[] = [];
    const firstStaves: Stave[] = [];
    const lastStaves: Stave[] = [];

    sys.bars.forEach((b, bi) => {
      const m = score.measures[b];
      const w = sys.widths[bi];
      const firstInSystem = bi === 0;
      const keyChanged = !firstInSystem && !sameKey(m.key, prevStartKey);
      const staves = defs.map((d, i) => {
        const st = new Stave(x, staffY[i], w);
        if (firstInSystem) {
          st.addClef(vexClef(d.clef), 'default', d.clef === 'treble8vb' ? '8vb' : undefined);
          st.addKeySignature(vexKeyName(m.key));
        } else if (keyChanged) {
          st.addKeySignature(vexKeyName(m.key), vexKeyName(prevStartKey));
        }
        if (b === 0 || m.timeChanged) st.addTimeSignature(`${m.time.beats}/${m.time.beatType}`);
        if (m.repeatStart) st.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (m.repeatEnd) st.setEndBarType(BarlineType.REPEAT_END);
        else if (m.finalBar || b === score.measures.length - 1) st.setEndBarType(BarlineType.END);
        else if (m.doubleBar) st.setEndBarType(BarlineType.DOUBLE);
        return st;
      });
      prevStartKey = m.keyChanges?.length ? m.keyChanges[m.keyChanges.length - 1].key : m.key;

      // Things written above the top staff.
      const topStave = staves[0];
      if (m.ending) {
        const t = m.ending.start && m.ending.end ? VoltaType.BEGIN_END : m.ending.start ? VoltaType.BEGIN : m.ending.end ? VoltaType.END : VoltaType.MID;
        topStave.setVoltaType(t, m.ending.start ? `${m.ending.numbers.join(', ')}.` : '', -10);
      }
      if (m.segno) topStave.setRepetitionType(Repetition.type.SEGNO_LEFT);
      if (m.coda) topStave.setRepetitionType(Repetition.type.CODA_LEFT);
      if (m.toCoda) topStave.setRepetitionType(Repetition.type.TO_CODA);
      if (m.fine) topStave.setRepetitionType(Repetition.type.FINE);
      if (m.jump) topStave.setRepetitionType(REPETITION[m.jump]);
      if (m.tempo) {
        const unit = m.tempo.beatUnit ? notate(m.tempo.beatUnit)?.[0] : undefined;
        topStave.setTempo(
          { name: m.tempo.text, duration: unit ? VEX_DUR[unit.base] : m.tempo.bpm ? 'q' : undefined, dots: unit?.dots, bpm: m.tempo.bpm },
          -12,
        );
      }

      // Tint bars that have a problem.
      if (opts.flaggedBars?.has(b)) {
        ctx.save();
        ctx.setFillStyle('rgba(220, 38, 38, 0.10)');
        ctx.fillRect(x, staves[0].getYForLine(0) - 6, w, staves[staves.length - 1].getBottomLineY() - staves[0].getYForLine(0) + 12);
        ctx.restore();
      }

      // Notes.
      const voices: Voice[] = [];
      const beams: Beam[] = [];
      const ties: StaveTie[] = [];
      const tuplets: Tuplet[] = [];
      const perStave: Voice[][] = [];
      defs.forEach((d, si2) => {
        const stave = staves[si2];
        const vs: Voice[] = [];
        const accs = staffAccidentals(score, d.parts, b);
        for (const part of d.parts) {
          const stem = d.parts.length > 1 ? part.stem : 'auto';
          const built = buildPartBar(score, part, b, d.clef, stem, accs, lastDrawn, ties, si, !!opts.plain);
          tuplets.push(...built.tuplets);
          const voice = new Voice({ numBeats: m.time.beats, beatValue: m.time.beatType }).setMode(VoiceMode.SOFT);
          voice.addTickables(built.notes);
          vs.push(voice);
          beams.push(...built.beams);
          for (const dr of built.drawn) drawnInSystem.push({ ...dr, stave });
        }
        perStave.push(vs);
        voices.push(...vs);
      });

      // Line up the first note across all staves, then space the notes.
      const startX = Math.max(...staves.map((s) => s.getNoteStartX()));
      staves.forEach((s) => s.setNoteStartX(startX));
      const fmt = new Formatter();
      perStave.forEach((vs) => vs.length && fmt.joinVoices(vs));
      if (voices.length) fmt.format(voices, Math.max(20, x + w - startX - 14));

      staves.forEach((s) => s.setContext(ctx).draw());
      perStave.forEach((vs, i) => vs.forEach((v) => v.draw(ctx, staves[i])));
      beams.forEach((bm) => bm.setContext(ctx).draw());
      tuplets.forEach((t) => t.setContext(ctx).draw());
      ties.forEach((t) => t.setContext(ctx).draw());

      if (staves.length > 1) {
        new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleRight').setContext(ctx).draw();
        if (firstInSystem) new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleLeft').setContext(ctx).draw();
      }
      if (firstInSystem) firstStaves.push(...staves);
      lastStaves.splice(0, lastStaves.length, ...staves);

      // Mid-bar key changes (sol-fa modulations): a small label at the note.
      for (const kc of m.keyChanges ?? []) {
        if (kc.offset.n === 0) continue;
        const at = drawnInSystem.find((d) => d.part.measures[b]?.events.includes(d.ev) && eq(eventStarts(d.part.measures[b].events)[d.part.measures[b].events.indexOf(d.ev)], kc.offset));
        if (at) text(ctx, `(Key ${vexKeyName(kc.key)})`, at.first.getAbsoluteX(), topStave.getYForLine(0) - 24, 10, 'italic');
      }
      for (const tc of m.tempoChanges ?? []) {
        const at = drawnInSystem.find((d) => d.stave === topStave && d.part.measures[b]?.events.includes(d.ev) && eq(eventStarts(d.part.measures[b].events)[d.part.measures[b].events.indexOf(d.ev)], tc.offset));
        const tx = at ? at.first.getAbsoluteX() : startX;
        text(ctx, tc.kind === 'rit' ? 'rit.' : tc.kind === 'accel' ? 'accel.' : 'a tempo', tx, topStave.getYForLine(0) - 26, 13, 'italic');
      }
      x += w;
    });

    // Brace / bracket and part labels at the start of the line.
    if (firstStaves.length > 1) {
      const conn = new StaveConnector(firstStaves[0], firstStaves[firstStaves.length - 1]).setType(defs.length === 2 ? 'brace' : 'bracket');
      conn.setContext(ctx).draw();
    }
    defs.forEach((d, i) => {
      const st = firstStaves[i];
      if (!st) return;
      const label = d.parts.map((p) => p.id).join(' ');
      text(ctx, label, 4, (st.getYForLine(0) + st.getBottomLineY()) / 2 + 4, 12, 'bold');
    });
    // Bar number at the start of each line.
    const firstBar = score.measures[sys.bars[0]];
    if (firstStaves[0] && !firstBar.pickup) text(ctx, String(firstBar.number), LEFT, firstStaves[0].getYForLine(0) - 14, 10);

    drawExpressions(ctx, drawnInSystem, defs, slurStart, hairpinStart, lastStaves);

    for (const d of drawnInSystem) {
      const el = d.first.getSVGElement();
      if (el) {
        el.setAttribute('data-note-id', d.ev.id);
        noteElements.set(d.ev.id, el);
      }
    }
  });

  return {
    height,
    noteElements,
    systems: systems.map((_, si) => ({ top: tops[si], bottom: tops[si] + layoutY[si].height })),
    svg: container.querySelector('svg') ?? undefined,
  };
}

/** Which accidentals to print in one bar of one staff (the parts sharing it count together). */
function staffAccidentals(score: Score, parts: Part[], b: number): Map<string, (number | undefined)[]> {
  const m = score.measures[b];
  const items: { ev: NoteEvent; start: Frac; part: Part; tiedFrom?: Pitch[] }[] = [];
  for (const part of parts) {
    const pm = part.measures[b];
    if (!pm) continue;
    const starts = eventStarts(pm.events);
    let prev = tiedIntoBar(part, b);
    pm.events.forEach((ev, k) => {
      items.push({ ev, start: starts[k], part, tiedFrom: prev?.tieToNext ? prev.pitches : undefined });
      if (!ev.grace) prev = ev.kind === 'note' ? ev : undefined;
    });
  }
  items.sort((a, c) => a.start.n * c.start.d - c.start.n * a.start.d);
  const show = accidentalShower();
  const out = new Map<string, (number | undefined)[]>();
  for (const it of items) out.set(it.ev.id, show({ pitches: it.ev.pitches, key: keyAt(m, it.start), tiedFrom: it.tiedFrom }));
  return out;
}

function beamGroups(m: MeasureInfo): Fraction[] {
  const { beats, beatType } = m.time;
  if (beatType === 8 && beats % 3 === 0) return [new Fraction(3, 8)];
  if (beatType === 2) return [new Fraction(1, 4)];
  return [new Fraction(1, beatType)];
}

function buildPartBar(
  score: Score,
  part: Part,
  b: number,
  clef: Clef,
  stem: 'up' | 'down' | 'auto',
  accs: Map<string, (number | undefined)[]>,
  lastDrawn: Map<VoiceId, { note: StaveNote; system: number }>,
  ties: StaveTie[],
  system: number,
  plain: boolean,
) {
  const m = score.measures[b];
  const pm = part.measures[b];
  const notes: StaveNote[] = [];
  const drawn: Omit<Drawn, 'stave'>[] = [];
  const tupletGroups = new Map<string, { notes: StaveNote[]; actual: number; normal: number }>();
  let graces: GraceNote[] = [];
  const stemDir = stem === 'up' ? 1 : stem === 'down' ? -1 : undefined;

  if (!pm || pm.events.length === 0) {
    // Missing bar: show an empty whole-bar rest so the staff stays aligned.
    const r = new StaveNote({ keys: [restKey(clef, stem)], duration: 'wr', clef: vexClef(clef), alignCenter: true, durationOverride: new Fraction(m.time.beats, m.time.beatType) });
    return { notes: [r], beams: [], tuplets: [], drawn };
  }

  let prevTie = tiedIntoBar(part, b);
  pm.events.forEach((ev) => {
    const keys = ev.kind === 'rest' ? [restKey(clef, stem)] : ev.pitches.map((p) => vexKey(p, clef));
    const lowConf = !plain && (ev.confidence ?? 1) < LOW_CONFIDENCE;
    if (ev.grace) {
      const g = new GraceNote({ keys, duration: VEX_DUR[notate(ev.duration)?.[0].base ?? 8], clef: vexClef(clef), slash: true });
      (accs.get(ev.id) ?? []).forEach((a, i) => a !== undefined && g.addModifier(new Accidental(VEX_ACC[a]), i));
      graces.push(g);
      return;
    }
    const wholeBarRest = ev.kind === 'rest' && pm.events.length === 1 && eq(ev.duration, barLength(m.time));
    const pieces: Notated[] = wholeBarRest ? [{ base: 1, dots: 0 }] : notate(written(ev)) ?? [{ base: 4, dots: 0 }];
    const made: StaveNote[] = pieces.map((piece, i) => {
      const n = new StaveNote({
        keys,
        duration: VEX_DUR[piece.base] + (ev.kind === 'rest' ? 'r' : ''),
        dots: piece.dots,
        clef: vexClef(clef),
        stemDirection: stemDir,
        autoStem: stemDir === undefined,
        alignCenter: wholeBarRest,
        durationOverride: wholeBarRest ? new Fraction(m.time.beats, m.time.beatType) : undefined,
      });
      if (piece.dots) Dot.buildAndAttach([n], { all: true });
      if (i === 0) {
        (accs.get(ev.id) ?? []).forEach((a, k) => a !== undefined && n.addModifier(new Accidental(VEX_ACC[a]), k));
        for (const a of ev.articulations ?? []) {
          n.addModifier(new Articulation(ARTIC_CODE[a]).setPosition(stemDir === -1 ? ModifierPosition.ABOVE : ModifierPosition.BELOW), 0);
        }
        if (ev.fermata) n.addModifier(new Articulation(stemDir === -1 ? 'a@u' : 'a@a').setPosition(stemDir === -1 ? ModifierPosition.BELOW : ModifierPosition.ABOVE), 0);
        if (graces.length) {
          n.addModifier(new GraceNoteGroup(graces, true).beamNotes(), 0);
          graces = [];
        }
      }
      if (lowConf) n.setStyle({ fillStyle: '#d97706', strokeStyle: '#d97706' });
      return n;
    });
    // Ties: between the pieces of one note, and from the previous note.
    const idx = ev.pitches.map((_, i) => i);
    for (let i = 1; i < made.length; i++) if (ev.kind === 'note') ties.push(new StaveTie({ firstNote: made[i - 1], lastNote: made[i], firstIndexes: idx, lastIndexes: idx }));
    const prev = lastDrawn.get(part.id);
    if (ev.kind === 'note' && prevTie?.tieToNext && prev) {
      if (prev.system === system) {
        ties.push(new StaveTie({ firstNote: prev.note, lastNote: made[0], firstIndexes: idx, lastIndexes: idx }));
      } else {
        // The tie crosses to a new line: draw half a tie at the end of one line and at the start of the next.
        ties.push(new StaveTie({ firstNote: prev.note, lastNote: undefined, firstIndexes: idx, lastIndexes: idx }));
        ties.push(new StaveTie({ firstNote: undefined, lastNote: made[0], firstIndexes: idx, lastIndexes: idx }));
      }
    }
    if (ev.tuplet) {
      const g = tupletGroups.get(ev.tuplet.group) ?? { notes: [], actual: ev.tuplet.actual, normal: ev.tuplet.normal };
      g.notes.push(...made);
      tupletGroups.set(ev.tuplet.group, g);
    }
    notes.push(...made);
    drawn.push({ ev, part, first: made[0], last: made[made.length - 1] });
    lastDrawn.set(part.id, { note: made[made.length - 1], system });
    prevTie = ev.kind === 'note' ? ev : undefined;
  });

  const tuplets = [...tupletGroups.values()].map((g) => new Tuplet(g.notes, { numNotes: g.actual, notesOccupied: g.normal, bracketed: true }));
  let beams: Beam[] = [];
  try {
    beams = Beam.generateBeams(notes.filter((n) => !n.isRest()), { groups: beamGroups(m), stemDirection: stemDir, maintainStemDirections: stemDir === undefined });
  } catch {
    beams = [];
  }
  return { notes, beams, tuplets, drawn };
}

function text(ctx: RenderContext, s: string, x: number, y: number, size = 12, style: 'normal' | 'italic' | 'bold' | 'bold italic' = 'normal') {
  ctx.save();
  ctx.setFont('Times New Roman, serif', size, style.includes('bold') ? 'bold' : 'normal', style.includes('italic') ? 'italic' : 'normal');
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Lyrics, dynamics, hairpins, slurs and pedal marks for one line of music. */
function drawExpressions(
  ctx: RenderContext,
  drawn: Drawn[],
  defs: StaffDef[],
  slurStart: Map<VoiceId, StaveNote>,
  hairpinStart: Map<VoiceId, { x: number; kind: 'cresc' | 'dim'; y: number }>,
  lastStaves: Stave[],
) {
  const center = (n: StaveNote) => (n.getNoteHeadBeginX() + n.getNoteHeadEndX()) / 2;

  // Lyrics: one line per (part, verse) under each staff.
  defs.forEach((d) => {
    let line = 0;
    for (const part of d.parts) {
      const verses = new Set<number>();
      for (const x of drawn) if (x.part === part) for (const l of x.ev.lyrics ?? []) verses.add(l.verse);
      for (const verse of [...verses].sort()) {
        const items = drawn.filter((x) => x.part === part);
        if (!items.length) continue;
        // Below the lowest note or stem on this staff, so lyrics never collide with notes.
        const lowest = Math.max(
          ...drawn.filter((x) => x.stave.getY() === items[0].stave.getY()).map((x) => {
            const bb = x.first.getBoundingBox();
            return bb ? bb.getY() + bb.getH() : 0;
          }),
        );
        const y = Math.max(items[0].stave.getBottomLineY() + 24, lowest + 16) + line * 17;
        let pendingHyphen: number | undefined;
        let extendFrom: number | undefined;
        let extendTo: number | undefined;
        ctx.save();
        ctx.setFont('Times New Roman, serif', 13);
        for (const it of items) {
          const l = it.ev.lyrics?.find((v) => v.verse === verse);
          if (!l) {
            if (extendFrom !== undefined && it.ev.kind === 'note') extendTo = it.last.getNoteHeadEndX();
            continue;
          }
          if (extendFrom !== undefined && extendTo !== undefined) ctx.fillRect(extendFrom, y + 2, extendTo - extendFrom, 1);
          extendFrom = extendTo = undefined;
          const w = ctx.measureText(l.text).width;
          const cx = center(it.first) - w / 2;
          if (pendingHyphen !== undefined && cx - pendingHyphen > 8) ctx.fillText('-', (pendingHyphen + cx) / 2 - 2, y);
          ctx.fillText(l.text, cx, y);
          pendingHyphen = l.syllabic === 'begin' || l.syllabic === 'middle' ? cx + w : undefined;
          if (l.extend) extendFrom = cx + w + 1;
        }
        if (extendFrom !== undefined && extendTo !== undefined) ctx.fillRect(extendFrom, y + 2, extendTo - extendFrom, 1);
        ctx.restore();
        line++;
      }
    }
  });

  // Dynamics and hairpins above each staff; pedal marks below.
  const seen = new Set<string>();
  for (const it of drawn) {
    const topY = it.stave.getYForLine(0) - 8;
    const x = center(it.first);
    if (it.ev.dynamic) {
      const key = `${it.stave.getY()}-${Math.round(x)}-${it.ev.dynamic}`;
      if (!seen.has(key)) {
        seen.add(key);
        text(ctx, it.ev.dynamic, x - 6, topY, 14, 'bold italic');
      }
    }
    if (it.ev.hairpin === 'cresc' || it.ev.hairpin === 'dim') hairpinStart.set(it.part.id, { x: x + 14, kind: it.ev.hairpin, y: topY - 4 });
    else if (it.ev.hairpin === 'end') {
      const hs = hairpinStart.get(it.part.id);
      if (hs) drawHairpin(ctx, hs.x, x - 4, hs.y, hs.kind);
      hairpinStart.delete(it.part.id);
    }
    if (it.ev.pedal) text(ctx, it.ev.pedal === 'down' ? 'Ped.' : '*', x - 8, it.stave.getBottomLineY() + 14, 12, 'italic');
    if (it.ev.slurStart) slurStart.set(it.part.id, it.first);
    if (it.ev.slurEnd) {
      const from = slurStart.get(it.part.id);
      const sameLine = from && drawn.some((d) => d.first === from);
      new Curve(sameLine ? from : undefined, it.last, { invert: it.part.stem === 'down' }).setContext(ctx).draw();
      slurStart.delete(it.part.id);
    }
  }
  // Hairpins and slurs still open at the end of the line continue to the next line.
  const endX = lastStaves[0] ? lastStaves[0].getX() + lastStaves[0].getWidth() - 4 : 0;
  for (const [id, hs] of hairpinStart) {
    drawHairpin(ctx, hs.x, endX, hs.y, hs.kind);
    hairpinStart.set(id, { ...hs, x: 60 });
  }
  for (const from of slurStart.values()) {
    if (drawn.some((d) => d.first === from)) new Curve(from, undefined, {}).setContext(ctx).draw();
  }
}

function drawHairpin(ctx: RenderContext, x1: number, x2: number, y: number, kind: 'cresc' | 'dim') {
  if (x2 - x1 < 10) return;
  const h = 5;
  ctx.save();
  ctx.setLineWidth(1);
  ctx.beginPath();
  if (kind === 'cresc') {
    ctx.moveTo(x2, y - h); ctx.lineTo(x1, y); ctx.lineTo(x2, y + h);
  } else {
    ctx.moveTo(x1, y - h); ctx.lineTo(x2, y); ctx.lineTo(x1, y + h);
  }
  ctx.stroke();
  ctx.restore();
}
