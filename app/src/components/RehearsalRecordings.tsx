// Rehearsal recordings: turns the score into MP3 files the choir can listen to at home —
// the full choir, or one file per part (your part loud, your part alone, or everyone but you
// so you can sing along) — and shares them (WhatsApp, email…) or downloads them.

import { useEffect, useState } from 'react';
import type { Score, VoiceId } from '../../../shared/model/types';
import { VOICE_NAMES } from '../../../shared/model/types';
import type { PlayStep } from '../../../shared/playback/expand';
import { buildSchedule } from '../../../shared/playback/schedule';
import type { ScorePlayer } from '../audio/player';

type Kind = 'full' | 'loud' | 'alone' | 'without';

const KINDS: { kind: Kind; label: string; help: string }[] = [
  { kind: 'full', label: 'Full choir', help: 'All parts at the same loudness — one file.' },
  { kind: 'loud', label: 'Each part loud', help: 'One file per part: that part loud, the others soft underneath. The usual rehearsal track.' },
  { kind: 'alone', label: 'Each part alone', help: 'One file per part with only that part — for learning the notes.' },
  { kind: 'without', label: 'Each part missing', help: 'One file per part with everyone except that part — sing your part along with it.' },
];

interface Recording {
  name: string;
  url: string;
  file: File;
  seconds: number;
}

interface Props {
  score: Score;
  steps: PlayStep[];
  speed: number;
  countIn: boolean;
  getPlayer: () => Promise<ScorePlayer>;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'Song';

export function RehearsalRecordings({ score, steps, speed, countIn, getPlayer }: Props) {
  const [kind, setKind] = useState<Kind>('loud');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const voices = score.parts.map((p) => p.id);
  const title = safe(score.meta.title ?? 'Song');

  // New score → old recordings no longer match.
  useEffect(() => {
    setRecordings((old) => {
      old.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
  }, [score]);

  const mixes = (): { name: string; gains: Record<VoiceId, number> }[] => {
    const g = (f: (v: VoiceId) => number) => Object.fromEntries((['S', 'A', 'T', 'B'] as VoiceId[]).map((v) => [v, voices.includes(v) ? f(v) : 0])) as Record<VoiceId, number>;
    if (kind === 'full' || voices.length === 1) return [{ name: 'Full choir', gains: g(() => 1) }];
    return voices.map((v) => {
      const n = VOICE_NAMES[v];
      if (kind === 'loud') return { name: `${n} loud`, gains: g((x) => (x === v ? 1 : 0.22)) };
      if (kind === 'alone') return { name: `${n} only`, gains: g((x) => (x === v ? 1 : 0)) };
      return { name: `All but ${n} (sing along)`, gains: g((x) => (x === v ? 0 : 1)) };
    });
  };

  const make = async () => {
    setError(undefined);
    try {
      setBusy('Loading the piano sounds…');
      const player = await getPlayer();
      await player.load();
      const schedule = buildSchedule(score, steps, { speed: speed / 100 });
      const { toMp3 } = await import('../audio/encode');
      const out: Recording[] = [];
      const list = mixes();
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        setBusy(`Recording “${m.name}” (${i + 1} of ${list.length})…`);
        const audio = await player.render(schedule, { countIn, beatsPerBar: score.measures[steps[0]?.measure ?? 0]?.time.beats ?? 4, gains: m.gains });
        setBusy(`Making the MP3 for “${m.name}” (${i + 1} of ${list.length})…`);
        const blob = await toMp3(audio);
        const tempo = speed === 100 ? '' : ` (${Math.round(speed)}% speed)`;
        const file = new File([blob], `${title} - ${m.name}${tempo}.mp3`, { type: 'audio/mpeg' });
        out.push({ name: m.name, url: URL.createObjectURL(blob), file, seconds: audio.duration });
      }
      setRecordings((old) => {
        old.forEach((r) => URL.revokeObjectURL(r.url));
        return out;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const canShare = (files: File[]) => {
    try {
      return !!navigator.canShare?.({ files });
    } catch {
      return false;
    }
  };
  const share = async (files: File[]) => {
    try {
      await navigator.share({ files, title: score.meta.title ?? 'Rehearsal recordings', text: `${score.meta.title ?? 'Our song'} — rehearsal recordings from Tosingwell` });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Sharing did not work here — use Download, then send the files from your phone or computer.');
    }
  };
  const download = (r: Recording) => {
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.file.name;
    a.click();
  };
  const all = recordings.map((r) => r.file);
  const sizeMb = (all.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(1);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  return (
    <div className="rehearsal">
      <h3>🎙 Rehearsal recordings</h3>
      <p className="muted small">
        Make MP3 files of this song for your choir to practise with at home. They follow the play order above, the speed
        {countIn ? ' and the count-in' : ''} you have set.
      </p>
      <div className="row">
        {KINDS.map((k) => (
          <label key={k.kind} className="small" title={k.help}>
            <input type="radio" name="rec-kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} disabled={!!busy} /> {k.label}
          </label>
        ))}
      </div>
      <p className="muted small">{KINDS.find((k) => k.kind === kind)!.help}</p>
      <div className="row">
        <button className="primary" onClick={make} disabled={!!busy}>
          🎙 Make {kind === 'full' || voices.length === 1 ? 'the recording' : `${voices.length} recordings`}
        </button>
        {busy && <span className="position">{busy}</span>}
      </div>
      {error && <p className="error small">{error}</p>}
      {recordings.length > 0 && (
        <>
          <ul className="recordings">
            {recordings.map((r) => (
              <li key={r.url}>
                <strong>{r.name}</strong> <span className="muted small">{mmss(r.seconds)} · {(r.file.size / 1e6).toFixed(1)} MB</span>
                <audio controls src={r.url} preload="none" />
                <span className="row">
                  <button onClick={() => download(r)}>⬇ Download</button>
                  {canShare([r.file]) && <button onClick={() => share([r.file])}>📤 Share</button>}
                </span>
              </li>
            ))}
          </ul>
          {recordings.length > 1 && (
            <div className="row">
              {canShare(all) && <button className="primary" onClick={() => share(all)}>📤 Share all {recordings.length} ({sizeMb} MB)</button>}
              <button onClick={() => recordings.forEach(download)}>⬇ Download all</button>
            </div>
          )}
          <p className="muted small">
            📤 Share opens your phone's share menu — choose WhatsApp and your choir group. On a computer without Share, use Download, then
            attach the files in WhatsApp or email. Recordings stay on this device until you send them.
          </p>
        </>
      )}
    </div>
  );
}
