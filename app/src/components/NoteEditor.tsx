// The small panel that opens when you click a note: fix its pitch, length,
// accidental, tie, or mark it as correct.

import type { Score } from '../../../shared/model/types';
import { frac, eq } from '../../../shared/model/fraction';
import { findEvent, type NoteEdit } from '../../../shared/edit/editNote';
import { defaultDohOctave, octaveMarks, pitchClassName, pitchToSolfa } from '../../../shared/convert/pitch';
import { keyAt, eventStarts } from '../../../shared/model/score';
import { LOW_CONFIDENCE } from '../../../shared/analysis/checks';

const LENGTHS: [string, ReturnType<typeof frac>][] = [
  ['whole', frac(1)], ['dotted half', frac(3, 4)], ['half', frac(1, 2)], ['dotted quarter', frac(3, 8)],
  ['quarter', frac(1, 4)], ['dotted eighth', frac(3, 16)], ['eighth', frac(1, 8)], ['16th', frac(1, 16)], ['32nd', frac(1, 32)],
];

interface Props {
  score: Score;
  id: string;
  onEdit: (e: NoteEdit) => void;
  onClose: () => void;
}

export function NoteEditor({ score, id, onEdit, onClose }: Props) {
  const found = findEvent(score, id);
  if (!found) return null;
  const { part, bar, index, ev } = found;
  const m = score.measures[bar];
  const key = keyAt(m, eventStarts(part.measures[bar].events)[index]);
  const names = ev.pitches.map((p) => `${pitchClassName(p, true)}${p.octave}`).join(' + ');
  const solfa = ev.pitches
    .map((p) => {
      const s = pitchToSolfa(p, key, score.dohOctave ?? defaultDohOctave(key), part.id);
      return s.syllable + octaveMarks(s.octave);
    })
    .join(' + ');
  const lengthIdx = LENGTHS.findIndex(([, f]) => eq(f, ev.duration));
  const uncertain = (ev.confidence ?? 1) < LOW_CONFIDENCE;

  return (
    <div className="note-editor" role="dialog" aria-label="Edit note">
      <div className="row">
        <strong>
          {part.name}, {m.pickup ? 'pickup bar' : `bar ${m.number}`}, {ev.kind === 'rest' ? 'rest' : 'note'} {index + 1}
        </strong>
        <span>{ev.kind === 'note' ? `${names}  (sol-fa: ${solfa})` : 'Rest'}</span>
        {uncertain && <span className="pill pill-warning">uncertain ({Math.round((ev.confidence ?? 1) * 100)}%)</span>}
        <span className="spacer" />
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="row">
        {ev.kind === 'note' && (
          <>
            <span className="label">Pitch</span>
            <button onClick={() => onEdit({ type: 'step', delta: 1 })} title="One note higher">▲</button>
            <button onClick={() => onEdit({ type: 'step', delta: -1 })} title="One note lower">▼</button>
            <button onClick={() => onEdit({ type: 'octave', delta: 1 })}>Octave ↑</button>
            <button onClick={() => onEdit({ type: 'octave', delta: -1 })}>Octave ↓</button>
            <button onClick={() => onEdit({ type: 'accidental', alter: -1 })}>♭</button>
            <button onClick={() => onEdit({ type: 'accidental', alter: 0 })}>♮</button>
            <button onClick={() => onEdit({ type: 'accidental', alter: 1 })}>♯</button>
          </>
        )}
      </div>
      <div className="row">
        <label>
          Length{' '}
          <select value={lengthIdx} onChange={(e) => onEdit({ type: 'length', duration: LENGTHS[Number(e.target.value)][1] })}>
            {lengthIdx < 0 && <option value={-1}>(other)</option>}
            {LENGTHS.map(([name], i) => <option key={name} value={i}>{name}</option>)}
          </select>
        </label>
        {ev.kind === 'note' ? (
          <>
            <button onClick={() => onEdit({ type: 'tie' })}>{ev.tieToNext ? 'Remove tie' : 'Tie to next'}</button>
            <button onClick={() => onEdit({ type: 'kind', kind: 'rest' })}>Make it a rest</button>
          </>
        ) : (
          <button onClick={() => onEdit({ type: 'kind', kind: 'note' })}>Make it a note</button>
        )}
        <button onClick={() => onEdit({ type: 'delete' })}>Delete</button>
        {uncertain && <button className="primary" onClick={() => onEdit({ type: 'confirm' })}>✓ It’s correct</button>}
      </div>
      <p className="muted small">Changes update the text, both notations, the checks and playback straight away.</p>
    </div>
  );
}
