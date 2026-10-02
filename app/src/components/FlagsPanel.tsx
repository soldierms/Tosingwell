import { useState } from 'react';
import type { Flag } from '../../../shared/model/types';

const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' };

export function FlagsPanel({ flags }: { flags: Flag[] }) {
  const [showInfo, setShowInfo] = useState(false);
  const order = { error: 0, warning: 1, info: 2 };
  const shown = flags
    .filter((f) => showInfo || f.level !== 'info')
    .sort((a, b) => order[a.level] - order[b.level] || (a.measure ?? -1) - (b.measure ?? -1));
  const infoCount = flags.filter((f) => f.level === 'info').length;
  return (
    <section className="card flags">
      <h2>Checks</h2>
      {shown.length === 0 && <p className="ok">✅ No problems found{infoCount ? ' (see notes below)' : ''}.</p>}
      <ul>
        {shown.map((f, i) => (
          <li key={i} className={`flag flag-${f.level}`}>
            <span aria-hidden>{ICON[f.level]}</span> {f.message}
          </li>
        ))}
      </ul>
      {infoCount > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> Show {infoCount} note
          {infoCount === 1 ? '' : 's'} (key changes, chromatic notes, pickup bar…)
        </label>
      )}
    </section>
  );
}
