// Draws a Score as Tonic Sol-fa (SVG), in the traditional layout:
// letters with bar lines, ":" between pulses, "." and "," inside pulses,
// commas and apostrophes for octaves. The four parts are lined up pulse by
// pulse, with lyrics under each part. Lines break only at bar lines.

import { useMemo } from 'react';
import type { NoteEvent, Score, VoiceId } from '../../../shared/model/types';
import { writeSolfaParts, type SolfaPiece } from '../../../shared/solfa/write';
import { keyLabel } from '../../../shared/convert/pitch';
import { LOW_CONFIDENCE } from '../../../shared/analysis/checks';

interface Props {
  score: Score;
  width: number;
  flaggedBars?: Set<number>;
  parts?: VoiceId[];
  /** Note ids to highlight (follow-along playback). */
  highlight?: Set<string>;
  /** Printing: no colours, no key line above (the page header has it). */
  plain?: boolean;
}

const FONT = 17;
const CHAR = FONT * 0.6; // monospace character width
const ROW = 30; // height of a row of notes
const LYRIC_ROW = 20;
const LABEL_W = 34;
const SEP_W = CHAR * 1.6;
const REPEAT_PAD = 12; // room for repeat dots next to a bar line

/** Text shown for a piece (without {marks}). */
const shown = (p: SolfaPiece) => p.text.replace(/\{[^}]*\}/g, '');

export function SolfaView({ score, width, flaggedBars, parts: only, highlight, plain }: Props) {
  const layout = useMemo(() => buildLayout(score, width, only), [score, width, only]);
  const events = useMemo(() => {
    const map = new Map<string, NoteEvent>();
    for (const p of score.parts) for (const m of p.measures) for (const e of m.events) map.set(e.id, e);
    return map;
  }, [score]);

  if (!layout.parts.length) return <p className="muted">No parts to show.</p>;

  let y = 0;
  const systems = layout.systems.map((sys, si) => {
    const top = y;
    const rows = layout.parts.map((sp) => {
      const hasLyrics = sp.hasLyrics;
      const rowTop = y + 26; // room above for instructions
      y += ROW + (hasLyrics ? LYRIC_ROW : 0);
      return { sp, rowTop, hasLyrics };
    });
    y += 46;
    const bottom = y - 30;

    return (
      <g key={si} className="solfa-system" data-y0={top} data-y1={y - 20}>
        {sys.bars.map(({ b, x, w, k }) => {
          const m = score.measures[b];
          const rowMids = rows.map((r) => r.rowTop + ROW / 2 - 5);
          const firstRowTop = rows[0].rowTop;
          const lastRowBottom = rows[rows.length - 1].rowTop + ROW - 6;
          const instrs = [...layout.bars[b].before, ...layout.bars[b].after].map(prettyDirective).filter(Boolean);
          return (
            <g key={b}>
              {flaggedBars?.has(b) && <rect x={x} y={firstRowTop - 4} width={w} height={bottom - firstRowTop + 8} fill="rgba(220,38,38,0.10)" />}
              {/* Ending bracket */}
              {m.ending && (
                <g className="ending">
                  <line x1={x + 2} x2={x + w - 2} y1={top + 8} y2={top + 8} stroke="currentColor" />
                  {m.ending.start && <line x1={x + 2} x2={x + 2} y1={top + 8} y2={top + 18} stroke="currentColor" />}
                  {m.ending.end && <line x1={x + w - 2} x2={x + w - 2} y1={top + 8} y2={top + 18} stroke="currentColor" />}
                  {m.ending.start && <text x={x + 6} y={top + 20} fontSize={12}>{m.ending.numbers.join(', ')}.</text>}
                </g>
              )}
              {instrs.length > 0 && (
                <text x={x + w - 4} y={top + (m.ending ? 4 : 14)} fontSize={12} fontStyle="italic" textAnchor="end">{instrs.join('  ')}</text>
              )}
              {!m.pickup && b === sys.bars[0].b && <text x={x + 2} y={firstRowTop - 12} fontSize={10} className="muted-fill">{m.number}</text>}
              {/* Bar line at the start of the bar */}
              <BarLine x={x} y1={firstRowTop} y2={lastRowBottom} rowMids={rowMids} kind={m.repeatStart ? 'repeatStart' : 'single'} />
              {/* Bar line at the end of the bar */}
              <BarLine x={x + w} y1={firstRowTop} y2={lastRowBottom} rowMids={rowMids} kind={m.repeatEnd ? 'repeatEnd' : m.finalBar || b === score.measures.length - 1 ? 'final' : m.doubleBar ? 'double' : 'single'} />
              {rows.map(({ sp, rowTop }) => {
                const bar = sp.bars[b];
                if (!bar) return null;
                let px = x + CHAR * 0.8 + (m.repeatStart ? REPEAT_PAD : 0);
                return bar.pulses.map((pulse, pi) => {
                  const pw = layout.pulseWidths[b][pi] ?? CHAR * 2;
                  const startX = px;
                  px += (pw + SEP_W) * k; // k stretches the line to the full width
                  let cx = startX;
                  const els = pulse.pieces.map((piece, k) => {
                    if (piece.kind === 'dir') {
                      const kc = /^\[key:(.*)\]$/.exec(piece.text);
                      return kc ? <text key={k} x={cx} y={rowTop - 8} fontSize={11} fontStyle="italic">Key {kc[1]}</text> : null;
                    }
                    const txt = shown(piece);
                    const at = cx;
                    cx += (txt.length + (piece.bridge ? piece.bridge.length * 0.7 : 0)) * CHAR;
                    if (piece.kind === 'sep') return <text key={k} x={at} y={rowTop + ROW / 2} fontSize={FONT} className="solfa-sep">{txt}</text>;
                    const ev = piece.eventId ? events.get(piece.eventId) : undefined;
                    const low = !plain && ev && (ev.confidence ?? 1) < LOW_CONFIDENCE;
                    const hl = piece.eventId && highlight?.has(piece.eventId);
                    return (
                      <g key={k}>
                        {hl && <rect x={at - 2} y={rowTop + 2} width={txt.length * CHAR + 4} height={ROW - 8} rx={3} className="hl" />}
                        <text x={at} y={rowTop + ROW / 2} fontSize={FONT} data-note-id={piece.eventId} className={low ? 'low-conf' : undefined}>
                          {piece.bridge && <tspan fontSize={FONT * 0.65} dy={-7}>{piece.bridge}</tspan>}
                          {piece.bridge ? <tspan dy={7}>{txt}</tspan> : txt}
                        </text>
                        {ev?.dynamic && <text x={at} y={rowTop} fontSize={12} fontStyle="italic" fontWeight="bold">{ev.dynamic}</text>}
                        {ev?.fermata && <text x={at} y={rowTop + 1} fontSize={13}>𝄐</text>}
                        {ev?.lyrics?.filter((l) => l.verse === 1).map((l, li) => (
                          <text key={li} x={at} y={rowTop + ROW + 12} fontSize={13} className="lyric">
                            {l.text}{l.syllabic === 'begin' || l.syllabic === 'middle' ? ' -' : l.extend ? ' _' : ''}
                          </text>
                        ))}
                      </g>
                    );
                  });
                  return (
                    <g key={pi}>
                      {els}
                      {pi < bar.pulses.length - 1 && <text x={px - SEP_W * 0.8} y={rowTop + ROW / 2} fontSize={FONT} className="solfa-sep">:</text>}
                    </g>
                  );
                });
              })}
            </g>
          );
        })}
        {rows.map(({ sp, rowTop }) => (
          <text key={sp.voice} x={2} y={rowTop + ROW / 2} fontSize={13} fontWeight="bold">{sp.voice}</text>
        ))}
      </g>
    );
  });

  const m0 = score.measures[0];
  return (
    <div className="solfa-view">
      {m0 && !plain && (
        <p className="solfa-key">
          {keyLabel(m0.key)} · {m0.time.beats}/{m0.time.beatType}
        </p>
      )}
      <svg width={width} height={y} viewBox={`0 0 ${width} ${y}`} className="solfa-svg" fontFamily="'DejaVu Sans Mono', Menlo, Consolas, monospace">
        {systems}
      </svg>
    </div>
  );
}

function BarLine({ x, y1, y2, kind, rowMids }: { x: number; y1: number; y2: number; rowMids: number[]; kind: 'single' | 'double' | 'final' | 'repeatStart' | 'repeatEnd' }) {
  // Repeat dots go on every row, in their own space beside the bar line.
  const dots = (dx: number) =>
    rowMids.map((my, i) => (
      <g key={i}>
        <circle cx={x + dx} cy={my - 4} r={1.8} fill="currentColor" />
        <circle cx={x + dx} cy={my + 4} r={1.8} fill="currentColor" />
      </g>
    ));
  return (
    <g className="barline">
      <line x1={x} x2={x} y1={y1} y2={y2} stroke="currentColor" strokeWidth={kind === 'final' ? 1 : 1.2} />
      {(kind === 'double' || kind === 'final') && <line x1={x - 4} x2={x - 4} y1={y1} y2={y2} stroke="currentColor" strokeWidth={1} />}
      {kind === 'final' && <line x1={x + 2} x2={x + 2} y1={y1} y2={y2} stroke="currentColor" strokeWidth={3} />}
      {kind === 'repeatStart' && (
        <>
          <line x1={x + 3} x2={x + 3} y1={y1} y2={y2} stroke="currentColor" strokeWidth={1} />
          {dots(8)}
        </>
      )}
      {kind === 'repeatEnd' && (
        <>
          <line x1={x - 3} x2={x - 3} y1={y1} y2={y2} stroke="currentColor" strokeWidth={1} />
          {dots(-8)}
        </>
      )}
    </g>
  );
}

/** "[D.C. al Fine]" → "D.C. al Fine"; endings are drawn as brackets instead. */
function prettyDirective(d: string): string {
  const inner = d.replace(/^\[|\]$/g, '');
  if (/^(ending:|\/ending)/.test(inner)) return '';
  if (inner.startsWith('time:')) return `Time ${inner.slice(5)}`;
  if (inner.startsWith('tempo:')) return inner.slice(6);
  if (inner === 'segno') return '𝄋';
  if (inner === 'coda') return '𝄌 Coda';
  if (inner === 'tocoda') return 'To Coda 𝄌';
  if (inner === 'fine') return 'Fine';
  return inner;
}

function buildLayout(score: Score, width: number, only?: VoiceId[]) {
  const { parts: all } = writeSolfaParts(score);
  const parts = all
    .filter((p) => !only || only.includes(p.voice))
    .map((sp) => ({
      ...sp,
      hasLyrics: score.parts.find((p) => p.id === sp.voice)!.measures.some((m) => m.events.some((e) => e.lyrics?.length)),
    }));
  const nBars = score.measures.length;
  // Width of each pulse = the widest version of it across the parts.
  const pulseWidths: number[][] = [];
  const barWidths: number[] = [];
  for (let b = 0; b < nBars; b++) {
    const widths: number[] = [];
    for (const sp of parts) {
      sp.bars[b]?.pulses.forEach((pulse, i) => {
        const chars = pulse.pieces.filter((p) => p.kind !== 'dir').reduce((n, p) => n + shown(p).length + (p.bridge ? p.bridge.length * 0.7 : 0), 0);
        let w = Math.max(chars, 1.5) * CHAR;
        // Leave room for lyrics under short notes.
        const longestLyric = pulse.pieces.reduce((n, p) => {
          if (!p.eventId) return n;
          const ev = score.parts.find((x) => x.id === sp.voice)!.measures[b].events.find((e) => e.id === p.eventId);
          return Math.max(n, ...(ev?.lyrics ?? []).map((l) => l.text.length + 1));
        }, 0);
        w = Math.max(w, longestLyric * 7.4 - SEP_W + 4);
        widths[i] = Math.max(widths[i] ?? 0, w);
      });
    }
    pulseWidths.push(widths);
    const m = score.measures[b];
    const pads = (m.repeatStart ? REPEAT_PAD : 0) + (m.repeatEnd ? REPEAT_PAD : 0);
    barWidths.push(CHAR * 1.6 + pads + widths.reduce((a, w) => a + w + SEP_W, 0));
  }
  // Pack bars into lines.
  const avail = width - LABEL_W - 8;
  const systems: { bars: { b: number; x: number; w: number; k: number }[] }[] = [];
  let cur: { b: number; x: number; w: number; k: number }[] = [];
  let used = 0;
  for (let b = 0; b < nBars; b++) {
    const w = barWidths[b];
    if (cur.length && used + w > avail) {
      systems.push({ bars: cur });
      cur = [];
      used = 0;
    }
    cur.push({ b, x: 0, w, k: 1 });
    used += w;
  }
  if (cur.length) systems.push({ bars: cur });
  systems.forEach((s, si) => {
    // Stretch full lines to the whole width (the last line only if it is fairly full).
    const total = s.bars.reduce((a, bar) => a + bar.w, 0);
    const stretch = si === systems.length - 1 && systems.length > 1 && total < avail * 0.6 ? 1 : Math.min(avail / total, 2.5);
    let x = LABEL_W;
    for (const bar of s.bars) {
      const fixed = CHAR * 1.6 + (bar.w - CHAR * 1.6 - pulseWidths[bar.b].reduce((a, w) => a + w + SEP_W, 0));
      const newW = bar.w * stretch;
      bar.k = (newW - fixed) / (bar.w - fixed);
      bar.w = newW;
      bar.x = x;
      x += newW;
    }
  });
  const bars = Array.from({ length: nBars }, (_, b) => parts[0]?.bars[b] ?? { index: b, before: [], pulses: [], after: [] });
  return { parts, pulseWidths, systems, bars };
}
