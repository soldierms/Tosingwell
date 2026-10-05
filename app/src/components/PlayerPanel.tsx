// Playback controls: play order (to confirm), play/pause/stop, solo/mute per
// part, speed, count-in and looping a few bars.

import { useEffect, useMemo, useState } from 'react';
import type { Score, VoiceId } from '../../../shared/model/types';
import { describePlayOrder, expandPlayOrder, type PlayStep } from '../../../shared/playback/expand';
import { buildSchedule, tempoValue } from '../../../shared/playback/schedule';
import type { ScorePlayer } from '../audio/player';

export interface FollowState {
  /** Note/rest ids sounding right now. */
  ids: Set<string>;
  /** Bar being played (index), and which step of the play order. */
  measure?: number;
  step?: number;
}

interface Props {
  score: Score;
  errorCount: number;
  onFollow: (f: FollowState) => void;
}

// The sound engine (Tone.js) is large, so it is only loaded the first time you press Play.
let loaded: ScorePlayer | undefined;
let loading: Promise<ScorePlayer> | undefined;
const getPlayer = () =>
  (loading ??= import('../audio/player').then((m) => {
    loaded = new m.ScorePlayer();
    return loaded;
  }));
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

export function PlayerPanel({ score, errorCount, onFollow }: Props) {
  const [repeatsAfterJump, setRepeatsAfterJump] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<'stopped' | 'loading' | 'playing' | 'paused'>('stopped');
  const [speed, setSpeed] = useState(100);
  const [countIn, setCountIn] = useState(true);
  const [loop, setLoop] = useState(false);
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(2);
  const [solo, setSolo] = useState<Set<VoiceId>>(new Set());
  const [mute, setMute] = useState<Set<VoiceId>>(new Set());
  const [position, setPosition] = useState<string>('');
  const [sound, setSound] = useState<string>();

  const { steps, flags } = useMemo(() => expandPlayOrder(score.measures, { repeatsAfterJump }), [score.measures, repeatsAfterJump]);
  const orderText = useMemo(() => describePlayOrder(steps, score.measures), [steps, score.measures]);
  const orderKey = orderText.join('|');

  // A new route through the score must be confirmed again.
  useEffect(() => setConfirmed(false), [orderKey]);
  // Stop when the score changes.
  useEffect(() => {
    loaded?.stop();
    setStatus('stopped');
    onFollow({ ids: new Set() });
  }, [score, onFollow]);

  useEffect(() => {
    for (const p of score.parts) {
      loaded?.setSolo(p.id, solo.has(p.id));
      loaded?.setMute(p.id, mute.has(p.id));
    }
  }, [solo, mute, score.parts]);

  const tempo = tempoValue(score.measures[0]?.tempo);
  const barNumbers = score.measures.map((m) => m.number);
  const minBar = Math.min(...barNumbers);
  const maxBar = Math.max(...barNumbers);

  const loopSteps = (): PlayStep[] => {
    const a = score.measures.findIndex((m) => m.number === Math.min(loopFrom, loopTo));
    const b = score.measures.findIndex((m) => m.number === Math.max(loopFrom, loopTo));
    if (a < 0 || b < 0) return steps;
    return Array.from({ length: b - a + 1 }, (_, k) => ({ measure: a + k, pass: 1, afterJump: false }));
  };

  const play = async () => {
    if (status === 'paused') {
      loaded?.resume();
      setStatus('playing');
      return;
    }
    setStatus('loading');
    const order = loop ? loopSteps() : steps;
    const schedule = buildSchedule(score, order, { speed: speed / 100 });
    const player = await getPlayer();
    const loadedSound = await player.load();
    for (const p of score.parts) {
      player.setSolo(p.id, solo.has(p.id));
      player.setMute(p.id, mute.has(p.id));
    }
    setSound(loadedSound === 'piano' ? 'Piano' : 'Simple synth (piano sounds could not be loaded — check the internet connection)');
    let lastKey = '';
    let lastBar = -1;
    await player.play(
      schedule,
      { countIn, beatsPerBar: score.measures[order[0]?.measure ?? 0]?.time.beats ?? 4, loop },
      {
        onTick: (t) => {
          // Which notes and rests are sounding now (by their written length).
          const ids = new Set<string>();
          for (const n of schedule.notes) {
            if (n.start > t) break; // notes are sorted by start time
            if (!n.grace && t < n.writtenEnd) ids.add(n.eventId);
          }
          const bar = schedule.bars.find((b) => t >= b.start && t < b.end);
          const key = [...ids].join();
          if (key !== lastKey) {
            lastKey = key;
            onFollow({ ids, measure: bar?.measure, step: bar?.step });
          }
          if (bar && bar.step !== lastBar) {
            lastBar = bar.step;
            const m = score.measures[bar.measure];
            const pass = order[bar.step]?.pass ?? 1;
            const label = m.pickup ? 'Pickup bar' : `Bar ${m.number}`;
            const when = m.ending
              ? ` (${m.ending.numbers.map((n) => ORDINAL[n] ?? `${n}th`).join(' & ')} ending)`
              : pass > 1
                ? ` (${ORDINAL[pass] ?? `${pass}th`} time)`
                : '';
            setPosition(`${label}${when}${order[bar.step]?.afterJump ? ' — after the D.C./D.S.' : ''}`);
          } else if (!bar && t < 0) setPosition('Count-in…');
        },
        onEnd: () => {
          setStatus('stopped');
          setPosition('');
          onFollow({ ids: new Set() });
        },
      },
    );
    setStatus('playing');
  };

  const pause = () => {
    loaded?.pause();
    setStatus('paused');
  };

  const stop = () => {
    loaded?.stop();
    setStatus('stopped');
    setPosition('');
    onFollow({ ids: new Set() });
  };

  const toggle = (set: Set<VoiceId>, v: VoiceId, update: (s: Set<VoiceId>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    update(next);
  };
  const only = (v: VoiceId | 'all') => {
    setMute(new Set());
    setSolo(v === 'all' ? new Set() : new Set([v]));
  };

  const canPlay = confirmed || loop;

  return (
    <section className="card player" id="play">
      <h2>Play</h2>

      <div className="play-order">
        <p className="label">Play order worked out from the repeat signs:</p>
        <ol>{orderText.map((t, i) => <li key={i}>{t}</li>)}</ol>
        {flags.map((f, i) => <p key={i} className="error">{f.message}</p>)}
        <label className="toggle">
          <input type="checkbox" checked={repeatsAfterJump} onChange={(e) => setRepeatsAfterJump(e.target.checked)} /> Take repeats again after D.C./D.S.
          (usually not)
        </label>
        <label className="confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have checked this order against the page
        </label>
      </div>

      {errorCount > 0 && (
        <p className="warning-text">⚠️ There {errorCount === 1 ? 'is 1 error' : `are ${errorCount} errors`} in the checks — playback may not match the page until they are fixed.</p>
      )}

      <div className="row transport">
        {status === 'playing' ? (
          <button onClick={pause}>⏸ Pause</button>
        ) : (
          <button className="primary" onClick={play} disabled={!canPlay || status === 'loading'} title={canPlay ? '' : 'Tick the box above first'}>
            {status === 'loading' ? 'Loading sounds…' : status === 'paused' ? '▶ Resume' : '▶ Play'}
          </button>
        )}
        <button onClick={stop} disabled={status === 'stopped'}>⏹ Stop</button>
        <span className="position" aria-live="polite">{position}</span>
      </div>
      {!canPlay && <p className="muted small">Tick “I have checked this order” to enable Play.</p>}

      <div className="parts">
        <div className="row">
          <span className="label">Play:</span>
          <button className={solo.size === 0 && mute.size === 0 ? 'on' : ''} onClick={() => only('all')}>All parts</button>
          {score.parts.map((p) => (
            <button key={p.id} className={solo.size === 1 && solo.has(p.id) ? 'on' : ''} onClick={() => only(p.id)}>{p.name} only</button>
          ))}
        </div>
        <table>
          <tbody>
            {score.parts.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><label><input type="checkbox" checked={solo.has(p.id)} onChange={() => toggle(solo, p.id, setSolo)} /> Solo</label></td>
                <td><label><input type="checkbox" checked={mute.has(p.id)} onChange={() => toggle(mute, p.id, setMute)} /> Mute</label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        <label className="speed">
          Speed {speed}%{' '}
          <input type="range" min={25} max={150} step={5} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={status !== 'stopped'} />
        </label>
        <span className="muted small">
          ≈ {Math.round((tempo.bpm * speed) / 100)} beats per minute{tempo.guessed ? ' (no number in the score, so this is a guess)' : ''}
        </span>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} disabled={status !== 'stopped'} /> Count-in (one bar of clicks)</label>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} disabled={status !== 'stopped'} /> Loop bars</label>
        <input type="number" min={minBar} max={maxBar} value={loopFrom} onChange={(e) => setLoopFrom(Number(e.target.value))} disabled={status !== 'stopped'} aria-label="Loop from bar" />
        to
        <input type="number" min={minBar} max={maxBar} value={loopTo} onChange={(e) => setLoopTo(Number(e.target.value))} disabled={status !== 'stopped'} aria-label="Loop to bar" />
        <span className="muted small">(plays these bars over and over, as written)</span>
      </div>
      {sound && <p className="muted small">Sound: {sound}</p>}
    </section>
  );
}
