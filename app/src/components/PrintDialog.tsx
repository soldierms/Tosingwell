// Print / Export PDF window: options on the left, a live preview of the real
// pages on the right. Printing uses the browser's print window; "Save as PDF"
// is the PDF export (it keeps the music sharp, as vector graphics).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Score, VoiceId } from '../../../shared/model/types';
import { pageSize } from '../../../shared/print/paginate';
import { buildPrintPages, type PrintNotation, type PrintOptions } from '../print/buildPages';
import { musicFontReady } from '../render/fonts';

interface Props {
  score: Score;
  notation: PrintNotation;
  tenorClef: 'bass' | 'treble8vb';
  /** 'pdf' shows the Save-as-PDF instructions. */
  mode: 'print' | 'pdf';
  onClose: () => void;
}


/** Paper choices are remembered on this device (a convenience only). */
const STORE_KEY = 'tosingwell.print';
function remembered(): Partial<Pick<PrintOptions, 'paper' | 'orientation'>> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function PrintDialog({ score, notation, tenorClef, mode, onClose }: Props) {
  const [opts, setOpts] = useState<PrintOptions>({
    notation,
    paper: remembered().paper ?? 'A4',
    orientation: remembered().orientation ?? 'portrait',
    parts: score.parts.map((p) => p.id),
    onePartPerPage: false,
    tenorClef,
    title: score.meta.title,
    composer: score.meta.composer ?? '',
    arranger: score.meta.arranger ?? '',
  });
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string>();
  const [zoom, setZoom] = useState(0.5);
  const pagesRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof PrintOptions>(k: K, v: PrintOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  // Rebuild the pages whenever an option changes.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      musicFontReady.then(() => {
        if (cancelled || !pagesRef.current) return;
        try {
          setPageCount(buildPrintPages(pagesRef.current, score, opts));
          setError(undefined);
        } catch (e) {
          console.error(e);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [score, opts]);

  // Fit the page width into the preview area.
  useLayoutEffect(() => {
    const fit = () => {
      const w = previewRef.current?.clientWidth ?? 600;
      setZoom(Math.min(1, (w - 32) / pageSize(opts.paper, opts.orientation).width));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [opts.paper, opts.orientation]);

  // Tell the browser the paper size, and name the PDF after the title.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ paper: opts.paper, orientation: opts.orientation }));
    } catch {
      // Private browsing: just don't remember.
    }
    const style = document.createElement('style');
    style.textContent = `@page { size: ${opts.paper === 'A4' ? 'A4' : 'letter'} ${opts.orientation}; margin: 0; }`;
    document.head.appendChild(style);
    const oldTitle = document.title;
    document.title = opts.title || 'Score';
    return () => {
      style.remove();
      document.title = oldTitle;
    };
  }, [opts.paper, opts.orientation, opts.title]);

  // Close with the Escape key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const togglePart = (v: VoiceId) =>
    set('parts', opts.parts.includes(v) ? opts.parts.filter((p) => p !== v) : score.parts.map((p) => p.id).filter((p) => p === v || opts.parts.includes(p)));

  return createPortal(
    <div className="print-overlay" role="dialog" aria-modal="true" aria-label="Print">
      <aside className="print-options">
        <div className="row">
          <h2>{mode === 'pdf' ? 'Export PDF' : 'Print'}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <fieldset>
          <legend>Notation</legend>
          {(['staff', 'solfa', 'both'] as PrintNotation[]).map((n) => (
            <label key={n}>
              <input type="radio" name="notation" checked={opts.notation === n} onChange={() => set('notation', n)} />{' '}
              {n === 'staff' ? 'Staff' : n === 'solfa' ? 'Tonic Sol-fa' : 'Both (staff, then sol-fa)'}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Paper</legend>
          <label><input type="radio" name="paper" checked={opts.paper === 'A4'} onChange={() => set('paper', 'A4')} /> A4</label>
          <label><input type="radio" name="paper" checked={opts.paper === 'Letter'} onChange={() => set('paper', 'Letter')} /> US Letter</label>
          <label><input type="radio" name="orient" checked={opts.orientation === 'portrait'} onChange={() => set('orientation', 'portrait')} /> Portrait</label>
          <label><input type="radio" name="orient" checked={opts.orientation === 'landscape'} onChange={() => set('orientation', 'landscape')} /> Landscape</label>
        </fieldset>

        <fieldset>
          <legend>Parts</legend>
          {score.parts.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={opts.parts.includes(p.id)} onChange={() => togglePart(p.id)} /> {p.name}
            </label>
          ))}
          <label><input type="radio" name="layout" checked={!opts.onePartPerPage} onChange={() => set('onePartPerPage', false)} /> All together</label>
          <label><input type="radio" name="layout" checked={opts.onePartPerPage} onChange={() => set('onePartPerPage', true)} /> Each part on its own page</label>
          {opts.notation !== 'solfa' && (
            <label>
              Tenor:{' '}
              <select value={opts.tenorClef} onChange={(e) => set('tenorClef', e.target.value as 'bass' | 'treble8vb')}>
                <option value="bass">bass staff</option>
                <option value="treble8vb">octave-treble clef</option>
              </select>
            </label>
          )}
          <p className="muted small">Lyrics print under the part they were typed for.</p>
        </fieldset>

        <fieldset>
          <legend>Page header</legend>
          <label className="stack">Title <input value={opts.title} onChange={(e) => set('title', e.target.value)} /></label>
          <label className="stack">Composer <input value={opts.composer} onChange={(e) => set('composer', e.target.value)} /></label>
          <label className="stack">Arranger <input value={opts.arranger} onChange={(e) => set('arranger', e.target.value)} /></label>
        </fieldset>

        {error && <p className="error">Could not prepare the pages: {error}</p>}
        <p className="muted">{pageCount} page{pageCount === 1 ? '' : 's'}</p>
        <button className="primary big" onClick={() => window.print()} disabled={!opts.parts.length || !pageCount}>
          {mode === 'pdf' ? '⬇ Save as PDF…' : '🖨 Print…'}
        </button>
        {mode === 'pdf' ? (
          <p className="print-hint small">
            In the window that opens, set the <b>Destination</b> (or printer) to <b>“Save as PDF”</b>, then press Save. On iPhone: tap
            Share → Print, then Share again → Save to Files.
          </p>
        ) : (
          <p className="print-hint small">Your browser’s print window will open. Set margins to “None” or “Default” and keep scale at 100%.</p>
        )}
        {!opts.parts.length && <p className="error">Choose at least one part.</p>}
      </aside>

      <div className="print-preview" ref={previewRef}>
        <div className="print-pages" ref={pagesRef} style={{ zoom }} />
      </div>
    </div>,
    document.body,
  );
}
