// Claude's reading of a photo → the app's typed format (staff text or sol-fa
// text). From there the normal, tested parsers build the Score, so photo
// scores get exactly the same rules and checks as typed scores.
//
// Nothing is invented here: unreadable bars stay empty (marked confidence 0,
// so the checks flag them), and every doubt Claude reported becomes a note
// for the review screen.

import type { Flag, VoiceId } from '../model/types';
import { VOICE_NAMES } from '../model/types';
import { parseKey } from '../convert/pitch';
import type { ReadingBar, ReadingEvent, ScoreReading } from './schema';

export interface ReadingResult {
  format: 'staff' | 'solfa';
  text: string;
  /** What the reader was unsure about, for the review screen. */
  notes: Flag[];
}

const ACC: Record<string, string> = { sharp: '#', flat: 'b', natural: 'n', 'double-sharp': '##', 'double-flat': 'bb' };
const LEN: Record<ReadingEvent['length'], string> = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't' };
const END_DIRECTIVES = /^(tocoda|to coda|fine|\/ending|d\.?c\.?|d\.?s\.?|da capo|dal segno)/i;
export const LOW = 0.8;

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const confMark = (c: number) => (c < 1 ? `conf=${Math.round(clamp01(c) * 100) / 100}` : '');
const clean = (s: string) => s.replace(/[[\]{}|]/g, '').trim();

function marks(ev: ReadingEvent): string {
  const w: string[] = [];
  for (const a of ev.articulations) w.push({ staccato: 'stacc', accent: 'acc', tenuto: 'ten', marcato: 'marc' }[a]);
  if (ev.fermata) w.push('ferm');
  if (ev.dynamic) w.push(ev.dynamic);
  if (ev.hairpin) w.push(ev.hairpin === 'cresc-start' ? 'cresc' : ev.hairpin === 'dim-start' ? 'dim' : '/hp');
  if (ev.slur === 'start') w.push('(');
  if (ev.slur === 'end') w.push(')');
  const c = confMark(ev.confidence);
  if (c) w.push(c);
  return w.length ? `{${w.join(',')}}` : '';
}

/** One bar of staff text from the events. */
function staffBar(bar: ReadingBar, octaveShift: number): string {
  const toks: string[] = [];
  for (const d of bar.directives) if (!END_DIRECTIVES.test(d.trim())) toks.push(`[${clean(d)}]`);
  if (!bar.events.length) {
    toks.push(`R{conf=0}`); // nothing readable: an empty bar, flagged — never guessed
  }
  for (const ev of bar.events) {
    if (ev.tupletStart) {
      const { actual, normal } = ev.tupletStart;
      toks.push(actual === 3 && normal === 2 ? '(3' : `(${actual}:${normal}`);
    }
    const len = LEN[ev.length] + '.'.repeat(Math.max(0, Math.min(2, ev.dots)));
    let tok: string;
    if (ev.kind === 'rest' || !ev.pitches.length) tok = `r${len}`;
    else {
      const names = ev.pitches.map((p) => `${p.step}${p.accidental ? ACC[p.accidental] : ''}${p.octave + octaveShift}`);
      tok = (ev.grace ? 'g' : '') + (names.length === 1 ? names[0] : `<${names.join(' ')}>`) + len + (ev.tie ? '~' : '');
    }
    toks.push(tok + marks(ev));
    if (ev.tupletEnd) toks.push(')');
  }
  for (const d of bar.directives) if (END_DIRECTIVES.test(d.trim())) toks.push(`[${clean(d)}]`);
  return toks.join(' ');
}

/** One bar of sol-fa text. */
function solfaBar(bar: ReadingBar): string {
  const start = bar.directives.filter((d) => !END_DIRECTIVES.test(d.trim())).map((d) => `[${clean(d)}]`);
  const end = bar.directives.filter((d) => END_DIRECTIVES.test(d.trim())).map((d) => `[${clean(d)}]`);
  // Remove any bar lines Claude copied; the app adds its own.
  let body = (bar.solfa ?? '').replace(/:?\|\|:?|\|\]|\|/g, ' ').trim();
  if (!body) body = '{conf=0}'; // nothing readable: an empty, flagged bar
  else if (bar.confidence < LOW && !body.includes('conf=')) {
    // Whole-bar doubt: mark the first note so it shows as uncertain.
    body = body.replace(/^([^:!.,\s]+)/, `$1{conf=${Math.round(clamp01(bar.confidence) * 100) / 100}}`);
  }
  return [...start, body, ...end].join(' ');
}

function barline(bar: ReadingBar, next: ReadingBar | undefined): string {
  if (bar.repeatEnd && next?.repeatStart) return ':||:';
  if (bar.repeatEnd) return ':||';
  if (next?.repeatStart) return '||:';
  if (bar.endBarline === 'final') return '|]';
  if (bar.endBarline === 'double') return '||';
  return '|';
}

/** Lyric line from per-note lyrics (staff scores). Only notes that can carry a lyric are counted. */
function lyricLine(bars: ReadingBar[]): string | undefined {
  const toks: string[] = [];
  let any = false;
  let tiedIn = false;
  for (const bar of bars) {
    for (const ev of bar.events) {
      if (ev.grace) continue;
      if (ev.kind === 'note' && ev.pitches.length && !tiedIn) {
        const l = ev.lyric?.trim();
        if (l) any = true;
        // "E -" → "E-" (word continues); inner spaces become "~" so a syllable stays one token.
        toks.push(l ? l.replace(/\s+-$/, '-').replace(/\s+/g, '~') : '*');
      }
      tiedIn = ev.kind === 'note' && ev.tie;
    }
  }
  while (toks.length && toks[toks.length - 1] === '*') toks.pop();
  return any ? toks.join(' ') : undefined;
}

export function readingToText(r: ScoreReading): ReadingResult {
  const notes: Flag[] = [];
  const note = (level: Flag['level'], message: string, part?: VoiceId, measure?: number) =>
    notes.push({ level, code: 'reading', message, part, measure });

  for (const p of r.photoProblems) note('warning', `Photo: ${p}`);
  for (const q of r.questions) note('warning', `Please check: ${q}`);
  if (r.notation === 'not-music') note('error', 'This picture does not look like a music score.');

  const format: 'staff' | 'solfa' = r.notation === 'solfa' ? 'solfa' : 'staff';
  const head: string[] = [];
  head.push(`Title: ${clean(r.title ?? '') || 'Untitled (from photo)'}`);
  if (r.composer) head.push(`Composer: ${clean(r.composer)}`);
  if (r.key && parseKey(r.key)) head.push(`Key: ${clean(r.key)}`);
  else note('warning', r.key ? `The key "${r.key}" could not be understood — please set it in the Key: line.` : 'No key was found on the page — please add a "Key:" line.');
  if (r.time) head.push(`Time: ${clean(r.time)}`);
  else note('warning', 'No time signature was found — please add a "Time:" line.');
  if (r.tempo) head.push(`Tempo: ${clean(r.tempo)}`);

  const lines: string[] = [head.join('\n'), ''];
  const order: VoiceId[] = ['S', 'A', 'T', 'B'];
  const parts = [...r.parts].sort((a, b) => order.indexOf(a.voice) - order.indexOf(b.voice));
  for (const part of parts) {
    const name = VOICE_NAMES[part.voice];
    const shift = part.clef === 'treble8vb' ? -1 : 0; // octave-treble clef sounds an octave lower
    part.bars.forEach((bar, i) => {
      const where = `${name}, bar ${bar.number}`;
      if (bar.unreadable) note('error', `${where}: could not be read${bar.problem ? ` — ${bar.problem}` : ''}. Please fill it in from the page.`, part.voice, i);
      else if (bar.problem) note('warning', `${where}: ${bar.problem}`, part.voice, i);
      else if (bar.confidence < LOW) note('warning', `${where}: read with low confidence (${Math.round(clamp01(bar.confidence) * 100)}%).`, part.voice, i);
    });
    const barTexts = part.bars.map((bar) => (format === 'solfa' ? solfaBar(bar) : staffBar(bar, shift)));
    const PER_LINE = 4;
    for (let i = 0; i < barTexts.length; i += PER_LINE) {
      let line = `${part.voice}: ${i === 0 && part.bars[0]?.repeatStart ? '||:' : '|'}`;
      for (let b = i; b < Math.min(i + PER_LINE, barTexts.length); b++) line += ` ${barTexts[b]} ${barline(part.bars[b], part.bars[b + 1])}`;
      lines.push(line);
    }
    const lyr = format === 'solfa'
      ? part.bars.map((b) => b.solfaLyrics?.trim() ?? '').filter(Boolean).join(' ')
      : lyricLine(part.bars);
    if (lyr) lines.push(`${part.voice}-lyrics: ${lyr}`);
  }
  if (!parts.length) note('error', 'No voice parts could be read from the photo.');
  for (const n of suspicious(r)) note('warning', n);
  return { format, text: lines.join('\n') + '\n', notes };
}

/** For adding a second page: drop the header lines so the parts simply continue. */
export function withoutHeader(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*(Title|Composer|Arranger|Key|Time|Tempo|Doh)\s*:/i.test(l))
    .join('\n');
}

/**
 * Signs that the reader guessed instead of reading: many identical bars in a part (a repeated
 * pattern), or claiming to be completely certain about every note on a whole page.
 */
export function suspicious(r: ScoreReading): string[] {
  const out: string[] = [];
  for (const part of r.parts) {
    if (part.bars.length < 8) continue;
    const sig = (b: ReadingBar) =>
      r.notation === 'solfa'
        ? (b.solfa ?? '').replace(/\s+/g, '')
        : b.events.map((e) => `${e.kind}${e.pitches.map((p) => `${p.step}${p.accidental ?? ''}${p.octave}`).join('+')}/${e.length}${e.dots}`).join(' ');
    const sigs = part.bars.map(sig).filter((x) => x.replace(/[-:!.]/g, '') !== ''); // ignore all-rest / all-hold bars
    if (sigs.length < 8) continue;
    const counts = new Map<string, number>();
    for (const x of sigs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const repeated = [...counts.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);
    if (counts.size / sigs.length < 0.4 && repeated / sigs.length > 0.6) {
      out.push(`${VOICE_NAMES[part.voice]}: ${repeated} of ${sigs.length} bars are exact copies of other bars. The reader may have repeated a pattern instead of reading each bar — check them carefully against the photo.`);
    }
  }
  // Only judged on a full page (about 80+ notes, or 40+ bars of sol-fa) — a short excerpt can be easy.
  const bars = r.parts.flatMap((p) => p.bars);
  const events = bars.flatMap((b) => b.events);
  const confs = [...bars.map((b) => b.confidence), ...events.map((e) => e.confidence)];
  const bigEnough = events.length >= 80 || (r.notation === 'solfa' && bars.length >= 40);
  if (bigEnough && confs.every((c) => c >= 0.99)) {
    out.push('The reader said it was completely sure of every note on the page, which is unlikely. Mistakes will not show in orange — please check every bar against the photo.');
  }
  return out;
}
