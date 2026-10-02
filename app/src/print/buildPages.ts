// Builds printable pages (real page-sized boxes) for the print preview and
// the browser's print / Save-as-PDF.
//
// How: draw the score once at the page's content width, then copy the SVG for
// each page with a "window" (viewBox) onto just the lines that belong there.
// The music stays vector (sharp at any zoom), and lines are never split, so a
// bar never breaks across lines or pages.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Score, VoiceId } from '../../../shared/model/types';
import { VOICE_NAMES } from '../../../shared/model/types';
import { contentHeights, contentWidth, PAGE, pageSize, paginate, printMetaLine, type Orientation, type PaperSize } from '../../../shared/print/paginate';
import { renderStaff } from '../render/staffRenderer';
import { SolfaView } from '../components/SolfaView';

export type PrintNotation = 'staff' | 'solfa' | 'both';

export interface PrintOptions {
  notation: PrintNotation;
  paper: PaperSize;
  orientation: Orientation;
  parts: VoiceId[];
  onePartPerPage: boolean;
  tenorClef: 'bass' | 'treble8vb';
  title: string;
  composer: string;
  arranger: string;
}

interface Section {
  notation: 'staff' | 'solfa';
  parts: VoiceId[];
  label: string;
}

interface Line {
  svg: SVGSVGElement;
  top: number;
  bottom: number;
}

function sections(opts: PrintOptions): Section[] {
  const notations: ('staff' | 'solfa')[] = opts.notation === 'both' ? ['staff', 'solfa'] : [opts.notation];
  const out: Section[] = [];
  const allFour = opts.parts.length === 4;
  for (const n of notations) {
    const nName = n === 'staff' ? 'Staff notation' : 'Tonic Sol-fa';
    if (opts.onePartPerPage) {
      for (const p of opts.parts) out.push({ notation: n, parts: [p], label: `${nName} — ${VOICE_NAMES[p]}` });
    } else {
      const who = allFour ? '' : ` — ${opts.parts.map((p) => VOICE_NAMES[p]).join(', ')}`;
      out.push({ notation: n, parts: opts.parts, label: `${nName}${who}` });
    }
  }
  return out;
}

/** Draw one section off-screen and return its lines of music. */
function drawSection(score: Score, sec: Section, width: number, opts: PrintOptions, scratch: HTMLElement): Line[] {
  const holder = document.createElement('div');
  scratch.appendChild(holder);
  if (sec.notation === 'staff') {
    const res = renderStaff(holder, score, { width, tenorClef: opts.tenorClef, parts: sec.parts, plain: true });
    if (!res.svg) return [];
    return res.systems.map((s) => ({ svg: res.svg!, top: s.top, bottom: s.bottom }));
  }
  holder.innerHTML = renderToStaticMarkup(createElement(SolfaView, { score, width, parts: sec.parts, plain: true }));
  const svg = holder.querySelector('svg');
  if (!svg) return [];
  return [...svg.querySelectorAll<SVGGElement>('g.solfa-system')].map((g) => ({
    svg,
    top: Number(g.dataset.y0),
    bottom: Number(g.dataset.y1),
  }));
}

/** A copy of the SVG showing only the part between top and bottom. */
function crop(svg: SVGSVGElement, width: number, top: number, bottom: number): SVGSVGElement {
  const c = svg.cloneNode(true) as SVGSVGElement;
  const h = bottom - top;
  c.setAttribute('viewBox', `0 ${top} ${width} ${h}`);
  c.setAttribute('width', String(width));
  c.setAttribute('height', String(h));
  c.style.display = 'block';
  c.style.maxWidth = 'none';
  return c;
}

const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Fill `container` with page boxes. Returns the number of pages. */
export function buildPrintPages(container: HTMLElement, score: Score, opts: PrintOptions): number {
  container.innerHTML = '';
  const size = pageSize(opts.paper, opts.orientation);
  const width = contentWidth(opts.paper, opts.orientation);
  const avail = contentHeights(opts.paper, opts.orientation);
  const meta = printMetaLine(score);

  // Off-screen area for drawing (VexFlow needs to be in the page to measure text).
  const scratch = el('div', 'print-scratch');
  document.body.appendChild(scratch);

  const pages: HTMLElement[] = [];
  try {
    for (const sec of sections(opts)) {
      const lines = drawSection(score, sec, width, opts, scratch);
      const groups = paginate(lines.map((l) => l.bottom - l.top), avail.first, avail.other);
      groups.forEach((idx, gi) => {
        const page = el('div', 'print-page');
        page.style.width = `${size.widthMm}mm`;
        page.style.height = `${size.heightMm - 0.5}mm`; // a hair short, so rounding never adds a blank page
        const inner = el('div', 'print-inner');
        inner.style.padding = `${PAGE.margin}px`;
        page.appendChild(inner);

        if (gi === 0) {
          const head = el('header', 'print-title-block');
          head.style.height = `${PAGE.titleBlock}px`;
          head.appendChild(el('h1', 'print-title', opts.title || 'Untitled'));
          const credits = el('div', 'print-credits');
          credits.appendChild(el('span', '', opts.arranger ? `Arr. ${opts.arranger}` : ''));
          credits.appendChild(el('span', '', opts.composer));
          head.appendChild(credits);
          head.appendChild(el('div', 'print-meta', meta));
          head.appendChild(el('div', 'print-section', sec.label));
          inner.appendChild(head);
        } else {
          const run = el('header', 'print-running', `${opts.title} — ${sec.label}`);
          run.style.height = `${PAGE.runningHeader}px`;
          inner.appendChild(run);
        }

        const music = el('div', 'print-music');
        if (idx.length) {
          const first = lines[idx[0]];
          const last = lines[idx[idx.length - 1]];
          // Lines of one page are next to each other, so one window covers them all.
          music.appendChild(crop(first.svg, width, first.top, last.bottom));
        }
        inner.appendChild(music);

        const foot = el('footer', 'print-footer');
        foot.style.height = `${PAGE.footer}px`;
        inner.appendChild(foot);
        pages.push(page);
      });
    }
  } finally {
    scratch.remove();
  }

  pages.forEach((p, i) => {
    p.querySelector('.print-footer')!.textContent = `${opts.title} — page ${i + 1} of ${pages.length}`;
    container.appendChild(p);
  });
  return pages.length;
}
