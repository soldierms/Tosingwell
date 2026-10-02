// Turns a Score + play order into a list of timed notes (in seconds) that the
// audio player can play, applying everything written on the page:
//   tempo and tempo words, rit./accel./a tempo, fermatas (everyone waits),
//   ties (one long note), dynamics and hairpins (loudness),
//   staccato/tenuto/accent/marcato, slurs, grace notes, rests.
// Pure code (no audio), so it can be tested.

import { frac, sum, toNumber, type Frac } from '../model/fraction';
import type { Dynamic, MeasureInfo, Score, Tempo, VoiceId } from '../model/types';
import { eventStarts } from '../model/score';
import { midi } from '../convert/pitch';
import { barLength } from '../textinput/common';
import type { PlayStep } from './expand';

export interface ScheduledNote {
  part: VoiceId;
  eventId: string;
  /** Index into the play order (which time through the score this is). */
  step: number;
  /** MIDI note numbers; empty for rests. */
  midi: number[];
  start: number; // seconds
  end: number; // seconds (when the sound stops)
  /** End of the written note (for highlighting), seconds. */
  writtenEnd: number;
  velocity: number; // 0..1
  rest?: boolean;
  grace?: boolean;
}

export interface ScheduledBar {
  step: number;
  measure: number;
  start: number;
  end: number;
}

export interface Schedule {
  notes: ScheduledNote[];
  bars: ScheduledBar[];
  duration: number;
  /** Tempo at the very start, for the count-in. */
  startBpm: number;
  startBeatSeconds: number;
}

export interface ScheduleOptions {
  /** 1 = as written, 0.5 = half speed. */
  speed?: number;
  /** Tempo used when the score gives none (quarter = 80). */
  defaultBpm?: number;
}

/** Tempo words → beats per minute (used when no number is written). */
const TEMPO_WORDS: [RegExp, number][] = [
  [/grave/i, 40], [/largo/i, 50], [/lento/i, 55], [/adagio/i, 66], [/andantino/i, 88], [/andante/i, 76],
  [/moderato/i, 100], [/allegretto/i, 112], [/allegro/i, 132], [/vivace/i, 150], [/presto/i, 176],
];

/** Beats per minute and beat length (fraction of a whole note) for a tempo marking. */
export function tempoValue(t: Tempo | undefined, defaultBpm = 80): { bpm: number; unit: Frac; guessed: boolean } {
  if (t?.bpm) return { bpm: t.bpm, unit: t.beatUnit ?? frac(1, 4), guessed: false };
  const word = t?.text && TEMPO_WORDS.find(([re]) => re.test(t.text!));
  if (word) return { bpm: word[1], unit: frac(1, 4), guessed: true };
  return { bpm: defaultBpm, unit: frac(1, 4), guessed: true };
}

const VELOCITY: Record<Dynamic, number> = {
  ppp: 0.18, pp: 0.28, p: 0.4, mp: 0.52, mf: 0.64, f: 0.76, ff: 0.88, fff: 0.98, sf: 0.9, sfz: 0.95, fp: 0.76,
};
const DEFAULT_VELOCITY = VELOCITY.mf;
const RIT_FACTOR = 0.7; // rit. slows to 70% of the tempo
const ACCEL_FACTOR = 1.3;
const RAMP_BARS = 2; // a rit./accel. takes effect over about two bars
const GRACE_SECONDS = 0.07;
const RES = 192; // integration steps per whole note

/** Length of a bar as played (pickup bars are short). */
function playedLength(score: Score, b: number): Frac {
  let best = frac(0);
  for (const p of score.parts) {
    const evs = p.measures[b]?.events ?? [];
    const len = sum(evs.filter((e) => !e.grace).map((e) => e.duration));
    if (toNumber(len) > toNumber(best)) best = len;
  }
  return toNumber(best) > 0 ? best : barLength(score.measures[b].time);
}

export function buildSchedule(score: Score, order: PlayStep[], opts: ScheduleOptions = {}): Schedule {
  const speed = opts.speed ?? 1;
  const ms = score.measures;

  // 1) Where each step starts, in whole notes along the play path.
  const stepPos: number[] = [];
  let pos = 0;
  for (const st of order) {
    stepPos.push(pos);
    pos += toNumber(playedLength(score, st.measure));
  }
  const total = pos;

  // 2) Tempo along the path: bar tempos, rit./accel. ramps, "a tempo".
  type TempoEvent = { at: number; kind: 'set'; bpm: number; unit: number } | { at: number; kind: 'rit' | 'accel' | 'a tempo' };
  const tEvents: TempoEvent[] = [];
  const start = tempoValue(ms[order[0]?.measure ?? 0]?.tempo ?? ms[0]?.tempo, opts.defaultBpm);
  tEvents.push({ at: 0, kind: 'set', bpm: start.bpm, unit: toNumber(start.unit) });
  order.forEach((st, k) => {
    const m = ms[st.measure];
    if (m.tempo && k > 0) {
      const tv = tempoValue(m.tempo, opts.defaultBpm);
      tEvents.push({ at: stepPos[k], kind: 'set', bpm: tv.bpm, unit: toNumber(tv.unit) });
    } else if (st.via === 'D.C.' || st.via === 'D.S.' || st.via === 'coda') {
      tEvents.push({ at: stepPos[k], kind: 'a tempo' }); // a jump ends any rit./accel.
    }
    for (const tc of m.tempoChanges ?? []) tEvents.push({ at: stepPos[k] + toNumber(tc.offset), kind: tc.kind });
  });
  tEvents.sort((a, b) => a.at - b.at);
  const avgBar = order.length ? total / order.length : 1;

  /** Seconds per whole note at a position. */
  const secPerWhole = (() => {
    // Pre-compute a piecewise description.
    return (x: number): number => {
      let bpm = start.bpm;
      let unit = toNumber(start.unit);
      let base = bpm;
      let ramp: { from: number; to: number; startBpm: number; factor: number } | undefined;
      for (let i = 0; i < tEvents.length && tEvents[i].at <= x + 1e-9; i++) {
        const e = tEvents[i];
        const cur = ramp ? rampBpm(ramp, e.at) : bpm;
        if (e.kind === 'set') { bpm = base = e.bpm; unit = e.unit; ramp = undefined; }
        else if (e.kind === 'a tempo') { bpm = base; ramp = undefined; }
        else {
          const next = tEvents.slice(i + 1).find((n) => n.kind !== 'rit' && n.kind !== 'accel');
          const to = Math.min(next ? next.at : total, e.at + RAMP_BARS * avgBar);
          ramp = { from: e.at, to: Math.max(to, e.at + 1e-6), startBpm: cur, factor: e.kind === 'rit' ? RIT_FACTOR : ACCEL_FACTOR };
          bpm = cur;
        }
      }
      const b = ramp ? rampBpm(ramp, x) : bpm;
      return 60 / b / unit / speed;
    };
  })();

  // Integrate to get seconds at any position.
  const nSteps = Math.ceil(total * RES) + 1;
  const cum = new Float64Array(nSteps + 1);
  for (let k = 0; k < nSteps; k++) cum[k + 1] = cum[k] + secPerWhole((k + 0.5) / RES) / RES;
  const rawTime = (x: number) => {
    const f = x * RES;
    const k = Math.min(Math.floor(f), nSteps - 1);
    return cum[k] + (cum[k + 1] - cum[k]) * (f - k);
  };

  // 3) Fermatas: everyone waits. The held note lasts about twice as long.
  const pauses = new Map<number, number>(); // position → extra seconds
  order.forEach((st, k) => {
    for (const part of score.parts) {
      const evs = part.measures[st.measure]?.events ?? [];
      const starts = eventStarts(evs);
      evs.forEach((ev, i) => {
        if (!ev.fermata || ev.grace) return;
        const s = stepPos[k] + toNumber(starts[i]);
        const e = s + toNumber(ev.duration);
        const extra = Math.min(Math.max(rawTime(e) - rawTime(s), 0.5 / speed), 3 / speed);
        const key = Math.round(e * 1e6) / 1e6;
        pauses.set(key, Math.max(pauses.get(key) ?? 0, extra));
      });
    }
  });
  const pauseList = [...pauses.entries()].sort((a, b) => a[0] - b[0]);
  const time = (x: number) => {
    let t = rawTime(x);
    for (const [p, extra] of pauseList) if (p <= x + 1e-9) t += extra;
    return t;
  };

  // 4) Notes, part by part along the play path.
  const notes: ScheduledNote[] = [];
  for (const part of score.parts) {
    let dyn = DEFAULT_VELOCITY;
    let slur = 0;
    let tiedFrom: ScheduledNote | undefined;
    let hairpin: { kind: 'cresc' | 'dim'; fromVel: number; startIdx: number } | undefined;
    const partNotes: ScheduledNote[] = [];
    const hairpinSpans: { kind: 'cresc' | 'dim'; from: number; to: number; fromVel: number }[] = [];
    let pendingGrace: { ev: (typeof part.measures)[number]['events'][number] }[] = [];

    order.forEach((st, k) => {
      const evs = part.measures[st.measure]?.events ?? [];
      const starts = eventStarts(evs);
      evs.forEach((ev, i) => {
        if (ev.grace) { pendingGrace.push({ ev }); return; }
        const s = stepPos[k] + toNumber(starts[i]);
        const e = s + toNumber(ev.duration);
        if (ev.dynamic) dyn = VELOCITY[ev.dynamic];
        if (ev.slurStart) slur++;
        const t0 = time(s);
        const t1 = time(e);
        // Grace notes just before the beat.
        for (const g of pendingGrace) {
          if (g.ev.kind === 'note') notes.push({ part: part.id, eventId: g.ev.id, step: k, midi: g.ev.pitches.map(midi), start: Math.max(0, t0 - GRACE_SECONDS / speed), end: t0, writtenEnd: t0, velocity: dyn * 0.85, grace: true });
        }
        pendingGrace = [];

        if (ev.kind === 'rest') {
          notes.push({ part: part.id, eventId: ev.id, step: k, midi: [], start: t0, end: t1, writtenEnd: t1, velocity: 0, rest: true });
          tiedFrom = undefined;
        } else {
          const pitches = ev.pitches.map(midi);
          if (tiedFrom && tiedFrom.midi.join() === pitches.join()) {
            // Continuation of a tie: the earlier note just sounds longer.
            tiedFrom.end = t1;
            tiedFrom.writtenEnd = t1;
            // Still record this event for follow-along highlighting.
            notes.push({ part: part.id, eventId: ev.id, step: k, midi: [], start: t0, end: t1, writtenEnd: t1, velocity: 0, rest: true });
          } else {
            let vel = dyn;
            if (ev.dynamic === 'sf' || ev.dynamic === 'sfz') dyn = DEFAULT_VELOCITY; // one-note accent
            if (ev.dynamic === 'fp') dyn = VELOCITY.p;
            if (ev.articulations?.includes('accent')) vel += 0.12;
            if (ev.articulations?.includes('marcato')) vel += 0.18;
            const len = t1 - t0;
            let soundLen = len * (slur > 0 || ev.articulations?.includes('tenuto') ? 1 : 0.94);
            if (ev.articulations?.includes('staccato')) soundLen = len * 0.45;
            const n: ScheduledNote = { part: part.id, eventId: ev.id, step: k, midi: pitches, start: t0, end: t0 + soundLen, writtenEnd: t1, velocity: Math.min(1, vel) };
            notes.push(n);
            partNotes.push(n);
            tiedFrom = undefined;
            if (ev.tieToNext) {
              n.end = t1; // a tied note is held to the end
              tiedFrom = n;
            }
          }
        }
        if (ev.slurEnd) slur = Math.max(0, slur - 1);
        if (ev.hairpin === 'cresc' || ev.hairpin === 'dim') hairpin = { kind: ev.hairpin, fromVel: dyn, startIdx: partNotes.length - 1 };
        else if (ev.hairpin === 'end' && hairpin) {
          hairpinSpans.push({ kind: hairpin.kind, from: hairpin.startIdx, to: partNotes.length - 1, fromVel: hairpin.fromVel });
          hairpin = undefined;
        }
      });
    });
    // Hairpins: loudness grows or shrinks smoothly to the next dynamic (or by about two levels).
    for (const h of hairpinSpans) {
      const span = partNotes.slice(Math.max(0, h.from), h.to + 1);
      const after = partNotes[h.to + 1];
      const target = after ? after.velocity : h.fromVel + (h.kind === 'cresc' ? 0.22 : -0.22);
      span.forEach((n, i) => {
        const f = span.length > 1 ? i / (span.length - 1) : 1;
        n.velocity = Math.max(0.1, Math.min(1, h.fromVel + (target - h.fromVel) * f));
      });
    }
  }
  notes.sort((a, b) => a.start - b.start);

  const bars: ScheduledBar[] = order.map((st, k) => ({
    step: k,
    measure: st.measure,
    start: time(stepPos[k]),
    end: time(stepPos[k] + toNumber(playedLength(score, st.measure))),
  }));
  const duration = time(total);
  return {
    notes,
    bars,
    duration,
    startBpm: start.bpm,
    startBeatSeconds: 60 / start.bpm / speed,
  };
}

function rampBpm(r: { from: number; to: number; startBpm: number; factor: number }, x: number) {
  const f = Math.min(1, Math.max(0, (x - r.from) / (r.to - r.from)));
  return r.startBpm * (1 + (r.factor - 1) * f);
}

/** For tests and the summary: the played tempo as words. */
export function tempoDescription(m: MeasureInfo | undefined, defaultBpm = 80): string {
  const tv = tempoValue(m?.tempo, defaultBpm);
  return tv.guessed ? `about ${tv.bpm} beats per minute` : `${tv.bpm} beats per minute`;
}

