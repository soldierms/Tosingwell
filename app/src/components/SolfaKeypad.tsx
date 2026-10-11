// Tap keypad for entering sol-fa without typing: pick the part, the octave and the length, then tap
// d r m f s l t. Each bar fills up beat by beat; a bar can never get too many beats, and when it is
// full it is added to the score by itself. Every tapped note is played, so wrong notes are heard at once.

import { useRef, useState } from 'react';
import type { Score, VoiceId } from '../../../shared/model/types';
import { VOICE_NAMES } from '../../../shared/model/types';
import { defaultDohOctave, midi } from '../../../shared/convert/pitch';
import { solfaNotePitches } from '../../../shared/edit/editNote';
import { appendBar, LENGTHS, renderBar, type Slot } from '../../../shared/solfa/keypad';

interface Props {
  score: Score;
  text: string;
  /** Replace the score text (goes on the Undo list). */
  onChange: (text: string) => void;
}

const MAIN = ['d', 'r', 'm', 'f', 's', 'l', 't'];
const CHROMATIC = ['de', 'ri', 'fe', 'se', 'ta', 'ma', 'la'];

let audio: AudioContext | undefined;
function beep(m: number) {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * 2 ** ((m - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.65);
  } catch {
    // no sound available: the keypad still works
  }
}

export function SolfaKeypad({ score, text, onChange }: Props) {
  const voices: VoiceId[] = ['S', 'A', 'T', 'B'];
  const [voice, setVoice] = useState<VoiceId>('S');
  const [octave, setOctave] = useState<'low' | 'mid' | 'high'>('mid');
  const [len, setLen] = useState(4);
  const [slots, setSlotsState] = useState<Slot[]>([]);
  // Taps can come faster than the screen updates: always build on the latest bar, not the last drawn one.
  const latest = useRef<Slot[]>([]);
  const setSlots = (s: Slot[]) => { latest.current = s; setSlotsState(s); };
  const textRef = useRef(text);
  textRef.current = text;
  const [msg, setMsg] = useState<string>();

  const last = score.measures[score.measures.length - 1];
  const key = last?.key ?? score.measures[0]?.key;
  const pulses = last?.time.beats ?? 4;
  const full = pulses * 4;
  const free = full - slots.length;
  const part = score.parts.find((p) => p.id === voice);
  const lastEvent = part?.measures[part.measures.length - 1]?.events.at(-1);
  const pulseName = last ? (last.time.beatType === 8 ? 'eighth-note beat' : last.time.beatType === 2 ? 'half-note beat' : 'beat') : 'beat';

  const commit = (s: Slot[]) => {
    if (s.length % 4) return setMsg('Finish the beat first (the bar must end on a whole beat).');
    const bar = renderBar(s, { tiedIn: !!lastEvent?.tieToNext });
    textRef.current = appendBar(textRef.current, voice, bar);
    onChange(textRef.current);
    setSlots([]);
    setMsg(`Added to ${VOICE_NAMES[voice]}: | ${bar} |`);
  };

  const add = (slot: Slot) => {
    const cur = latest.current;
    if (len > full - cur.length) return;
    const next = [...cur, slot, ...Array<Slot>(len - 1).fill({ kind: 'hold' })];
    setMsg(undefined);
    if (next.length === full) commit(next);
    else setSlots(next);
  };

  const tapNote = (syl: string) => {
    const written = syl + (octave === 'high' ? "'" : octave === 'low' ? ',' : '');
    if (key) {
      const p = solfaNotePitches(written, key, score.dohOctave ?? defaultDohOctave(key), voice);
      if (typeof p !== 'string' && p[0]) beep(midi(p[0]));
    }
    add({ kind: 'note', syl: written });
  };

  const undo = () => {
    // remove the last tapped item (a note/rest plus its held slots)
    const cur = latest.current;
    let i = cur.length - 1;
    while (i > 0 && cur[i].kind === 'hold') i--;
    setSlots(cur.slice(0, Math.max(0, i)));
  };

  const preview = renderBar([...slots, ...Array<Slot>((4 - (slots.length % 4)) % 4).fill({ kind: 'hold' })], { tiedIn: !!lastEvent?.tieToNext });
  const beatsDone = slots.length / 4;

  return (
    <div className="keypad">
      <div className="row">
        <span className="label">Part:</span>
        {voices.map((v) => (
          <button key={v} className={v === voice ? 'on' : ''} onClick={() => { if (slots.length) commit(slots); setVoice(v); }}>
            {VOICE_NAMES[v]}
          </button>
        ))}
      </div>
      <div className="row">
        <span className="label">Octave:</span>
        <button className={octave === 'low' ? 'on' : ''} onClick={() => setOctave('low')}>low ( , )</button>
        <button className={octave === 'mid' ? 'on' : ''} onClick={() => setOctave('mid')}>middle</button>
        <button className={octave === 'high' ? 'on' : ''} onClick={() => setOctave('high')}>high ( ' )</button>
      </div>
      <div className="row">
        <span className="label">Length:</span>
        {LENGTHS.filter((l) => l.slots <= full).map((l) => (
          <button key={l.slots} className={l.slots === len ? 'on' : ''} onClick={() => setLen(l.slots)} disabled={l.slots > free}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="keys">
        {MAIN.map((s) => (
          <button key={s} className="key" onClick={() => tapNote(s)} disabled={len > free}>
            {s}{octave === 'high' ? "'" : octave === 'low' ? ',' : ''}
          </button>
        ))}
      </div>
      <div className="keys small-keys">
        {CHROMATIC.map((s) => (
          <button key={s} onClick={() => tapNote(s)} disabled={len > free}>{s}</button>
        ))}
        <button onClick={() => add({ kind: 'rest' })} disabled={len > free} title="Silence for the chosen length">rest</button>
        <button onClick={() => add({ kind: 'hold' })} disabled={len > free || (!slots.length && !lastEvent)} title="Hold the last note longer (–)">hold –</button>
      </div>
      <div className="keypad-bar">
        <span className="muted small">
          {VOICE_NAMES[voice]}, new bar — {beatsDone} of {pulses} {pulseName}{pulses === 1 ? '' : 's'} filled:
        </span>
        <code>| {preview || ' '} {slots.length ? '' : '|'}</code>
      </div>
      <div className="row">
        <button onClick={undo} disabled={!slots.length}>⌫ Undo tap</button>
        <button onClick={() => commit(slots)} disabled={!slots.length}>Finish this bar early</button>
        <span className="muted small">A full bar is added by itself. Use ↶ Undo (top) to take back a whole bar.</span>
      </div>
      {msg && <p className="ok small">{msg}</p>}
    </div>
  );
}
