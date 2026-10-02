// React wrapper around the VexFlow staff renderer.

import { useEffect, useRef, useState } from 'react';
import type { Score, VoiceId } from '../../../shared/model/types';
import { renderStaff } from '../render/staffRenderer';

interface Props {
  score: Score;
  width: number;
  tenorClef: 'bass' | 'treble8vb';
  flaggedBars?: Set<number>;
  parts?: VoiceId[];
}

/** VexFlow measures text with its music font, so wait until the font has loaded. */
const fontsReady = document.fonts.load('30px Bravura').then(() => document.fonts.ready);

export function StaffView({ score, width, tenorClef, flaggedBars, parts }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fontsReady.then(() => {
      if (cancelled || !ref.current) return;
      try {
        renderStaff(ref.current, score, { width, tenorClef, flaggedBars, parts });
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

  return (
    <div className="staff-view">
      {error && <p className="error">Could not draw the staff notation: {error}</p>}
      <div ref={ref} />
    </div>
  );
}
