// React wrapper around the VexFlow staff renderer.

import { useEffect, useRef, useState } from 'react';
import type { Score, VoiceId } from '../../../shared/model/types';
import { renderStaff } from '../render/staffRenderer';
import { musicFontReady } from '../render/fonts';

interface Props {
  score: Score;
  width: number;
  tenorClef: 'bass' | 'treble8vb';
  flaggedBars?: Set<number>;
  parts?: VoiceId[];
  /** Note ids to highlight while playing. */
  highlight?: Set<string>;
}


export function StaffView({ score, width, tenorClef, flaggedBars, parts, highlight }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, SVGElement>());
  const lit = useRef<SVGElement[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    musicFontReady.then(() => {
      if (cancelled || !ref.current) return;
      try {
        elements.current = renderStaff(ref.current, score, { width, tenorClef, flaggedBars, parts }).noteElements;
        lit.current = [];
        setError(undefined);
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [score, width, tenorClef, flaggedBars, parts]);

  // Colour the notes being played (without redrawing the whole score).
  useEffect(() => {
    for (const el of lit.current) el.classList.remove('playing');
    lit.current = [];
    for (const id of highlight ?? []) {
      const el = elements.current.get(id);
      if (el) {
        el.classList.add('playing');
        lit.current.push(el);
      }
    }
  }, [highlight]);

  return (
    <div className="staff-view">
      {error && <p className="error">Could not draw the staff notation: {error}</p>}
      <div ref={ref} />
    </div>
  );
}
