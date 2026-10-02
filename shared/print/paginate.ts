// Page layout for printing. Lines of music (systems) are never split, so a
// bar never breaks across lines or pages: pages break only between lines.

import type { Key, Score, Tempo } from '../model/types';
import { lahOf, pitchClassName } from '../convert/pitch';
import { tempoText } from '../textinput/write';

export type PaperSize = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';

const MM: Record<PaperSize, [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4] };
export const PX_PER_MM = 96 / 25.4;

/** Page layout constants in CSS pixels (96 per inch). */
export const PAGE = {
  margin: 48, // about 12.7 mm
  titleBlock: 118, // title, composer, key/time/tempo line, section name
  runningHeader: 28, // small title on later pages
  footer: 30, // page number
};

export function pageSize(size: PaperSize, orientation: Orientation) {
  const [w, h] = orientation === 'portrait' ? MM[size] : [MM[size][1], MM[size][0]];
  return { widthMm: w, heightMm: h, width: Math.floor(w * PX_PER_MM), height: Math.floor(h * PX_PER_MM) };
}

/** Width available for music on the page. */
export const contentWidth = (size: PaperSize, orientation: Orientation) => pageSize(size, orientation).width - 2 * PAGE.margin;

/** Height available for music on the first page of a section, and on later pages. */
export function contentHeights(size: PaperSize, orientation: Orientation) {
  const h = pageSize(size, orientation).height - 2 * PAGE.margin - PAGE.footer;
  return { first: h - PAGE.titleBlock, other: h - PAGE.runningHeader };
}

/**
 * Put lines of music onto pages, in order, never splitting a line.
 * Returns the line indexes on each page. A line taller than a page gets a page of its own.
 */
export function paginate(lineHeights: number[], firstAvail: number, otherAvail: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  let avail = firstAvail;
  lineHeights.forEach((h, i) => {
    if (cur.length && used + h > avail) {
      pages.push(cur);
      cur = [];
      used = 0;
      avail = otherAvail;
    }
    cur.push(i);
    used += h;
  });
  if (cur.length || !pages.length) pages.push(cur);
  return pages;
}

/** "Key: G, Doh = G" or "Key: E minor, Doh = G". */
export function keyPrintLabel(key: Key): string {
  const doh = pitchClassName(key.doh, true);
  return key.mode === 'minor' ? `Key: ${pitchClassName(lahOf(key.doh), true)} minor, Doh = ${doh}` : `Key: ${doh}, Doh = ${doh}`;
}

/** The line under the title: "Key: G, Doh = G · Time: 4/4 · Tempo: Andante q=88". */
export function printMetaLine(score: Score): string {
  const m0 = score.measures[0];
  if (!m0) return '';
  const parts = [keyPrintLabel(m0.key), `Time: ${m0.time.beats}/${m0.time.beatType}`];
  const t: Tempo | undefined = m0.tempo;
  if (t) parts.push(`Tempo: ${tempoText(t)}`);
  return parts.join('   ·   ');
}
