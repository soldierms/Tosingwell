// The original photo, shown beside what was read. When you select a note,
// the bar it belongs to is boxed on the photo so you can compare.

import { useState } from 'react';

export interface PhotoPage {
  url: string;
  /** Where each bar is on this photo (fractions of width/height), by bar index from firstBar. */
  regions: ({ x: number; y: number; w: number; h: number } | null)[];
  firstBar: number;
}

export function PhotoView({ pages, bar }: { pages: PhotoPage[]; bar?: number }) {
  const [zoom, setZoom] = useState(false);
  const [manual, setManual] = useState<number>();
  if (!pages.length) return null;
  // The last page that starts at or before the selected bar.
  const auto = bar === undefined ? 0 : pages.reduce((best, p, i) => (p.firstBar <= bar ? i : best), 0);
  const pi = manual ?? auto;
  const page = pages[Math.min(pi, pages.length - 1)];
  const region = bar !== undefined && pi === auto ? page.regions[bar - page.firstBar] : null;

  return (
    <div className="photo-view">
      <div className="row">
        <strong>Original photo</strong>
        {pages.length > 1 && pages.map((_, i) => (
          <button key={i} className={i === pi ? 'on' : ''} onClick={() => setManual(i === auto ? undefined : i)}>Page {i + 1}</button>
        ))}
        <button onClick={() => setZoom((z) => !z)}>{zoom ? 'Fit' : 'Zoom'}</button>
      </div>
      <div className={zoom ? 'photo-frame zoomed' : 'photo-frame'}>
        <div className="photo-inner">
          <img src={page.url} alt="Original score" />
          {region && (
            <div
              className="photo-region"
              style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
            />
          )}
        </div>
      </div>
      <p className="muted small">Click a note in the music to box its bar here and fix it.</p>
    </div>
  );
}
