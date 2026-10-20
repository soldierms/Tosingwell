// A simple computer singer (formant synthesis, no recordings needed): a buzzing tone shaped by three
// resonances, like a throat and mouth, set for the vowel being sung, with a gentle vibrato. Sopranos and
// altos get a higher "mouth" than tenors and basses. Works in a live AudioContext and in the
// OfflineAudioContext used for rehearsal recordings.

import type { VoiceId } from '../../../shared/model/types';
import type { Onset, Vowel } from '../../../shared/playback/vowels';

/** Resonances (Hz) and their loudness for a man's voice; women's are about 17% higher. */
const FORMANTS: Record<Vowel, [number, number][]> = {
  a: [[730, 1], [1090, 0.5], [2440, 0.16]],
  e: [[400, 1], [2000, 0.3], [2550, 0.2]],
  ɛ: [[550, 1], [1770, 0.4], [2490, 0.16]],
  i: [[280, 1], [2250, 0.25], [2900, 0.2]],
  o: [[430, 1], [740, 0.6], [2400, 0.08]],
  ɔ: [[590, 1], [880, 0.6], [2540, 0.1]],
  u: [[310, 1], [760, 0.3], [2300, 0.05]],
  m: [[260, 1], [1000, 0.04], [2300, 0.02]],
};
const HIGH: Record<VoiceId, boolean> = { S: true, A: true, T: false, B: false };
/** Overall loudness of the singer (after evening out) compared with the piano. */
const LEVEL = 0.3;
const bandwidth = (f: number) => (f < 1000 ? 110 : 160);

/** The resonances for this vowel, voice and pitch. A high note pushes the lowest one up so it stays clear. */
function formants(vowel: Vowel, high: boolean, f0: number): [number, number][] {
  return FORMANTS[vowel].map(([f, amp], i) => [i === 0 ? Math.max(f * (high ? 1.17 : 1), f0 * 1.1) : f * (high ? 1.17 : 1), amp]);
}

/**
 * How loud the filtered buzz comes out, worked out from its overtones: some vowels on some pitches line up
 * with the resonances and would be much louder than others. Dividing by this keeps every note even.
 */
function loudness(fs: [number, number][], f0: number): number {
  let sq = 0;
  for (let k = 1; f0 * k < 5000; k++) {
    const f = f0 * k;
    let a = 0;
    for (const [fc, amp] of fs) {
      const q = fc / bandwidth(fc);
      a += amp / Math.sqrt(1 + q * q * (f / fc - fc / f) ** 2);
    }
    sq += (a / k) ** 2;
  }
  return Math.sqrt(sq / 2) * 0.6;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext) {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

export interface SungNote {
  part: VoiceId;
  freq: number;
  start: number; // context time, seconds
  dur: number; // seconds
  gain: number; // 0..1
  vowel: Vowel;
  onset: Onset;
}

/** Sing one note into `out`. Returns a function that silences it at once (for Stop/Pause). */
export function sing(ctx: BaseAudioContext, out: AudioNode, n: SungNote): () => void {
  const t = n.start;
  const end = t + Math.max(0.08, n.dur);
  const release = 0.12;
  const high = HIGH[n.part];
  const fs = formants(n.vowel, high, n.freq);
  const level = (n.gain * LEVEL) / Math.max(0.02, loudness(fs, n.freq));

  // The voice: two slightly different buzzes (warmer than one), with vibrato that grows after the start.
  const oscs = [0, 6].map((cents) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = n.freq;
    o.detune.value = cents;
    return o;
  });
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(0, t + Math.min(0.25, n.dur / 2));
  depth.gain.linearRampToValueAtTime(n.freq * 0.007, t + Math.min(0.6, n.dur));
  lfo.connect(depth);
  const parts: AudioNode[] = [lfo, depth, ...oscs]; // everything to disconnect when the note is over
  const source = ctx.createGain();
  parts.push(source);
  source.gain.value = 0.5;
  for (const o of oscs) {
    depth.connect(o.frequency);
    o.connect(source);
  }

  // The mouth: three resonances for the vowel.
  const env = ctx.createGain();
  const vowelStart = n.onset === 'breath' ? t + 0.03 : n.onset === 'nasal' ? t + 0.06 : t;
  const attack = n.onset === 'voiced' ? 0.025 : 0.05;
  env.gain.setValueAtTime(0, t);
  env.gain.setValueAtTime(0, vowelStart);
  env.gain.linearRampToValueAtTime(level, Math.min(vowelStart + attack, end));
  env.gain.setValueAtTime(level, end);
  env.gain.linearRampToValueAtTime(0, end + release);
  env.connect(out);
  parts.push(env);
  for (const [freq, amp] of fs) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = freq / bandwidth(freq);
    const g = ctx.createGain();
    g.gain.value = amp;
    source.connect(bp).connect(g).connect(env);
    parts.push(bp, g);
  }

  const stops: AudioScheduledSourceNode[] = [...oscs, lfo];
  // A hum before "n"/"m" syllables, a breath before "s"/"h"/"f" ones.
  if (n.onset === 'nasal') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(n.gain * LEVEL * 0.5, t + 0.02);
    g.gain.linearRampToValueAtTime(0, Math.min(t + 0.1, end));
    source.connect(lp).connect(g).connect(out);
    parts.push(lp, g);
  } else if (n.onset === 'breath') {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(n.gain * LEVEL * 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(hp).connect(g).connect(out);
    parts.push(s, hp, g);
    s.start(t);
    s.stop(t + 0.08);
    stops.push(s);
  }

  for (const o of [...oscs, lfo]) {
    o.start(t);
    o.stop(end + release + 0.02);
  }
  // Without this the browser keeps working on the silent filters of finished notes, which makes long
  // recordings very slow.
  oscs[0].onended = () => parts.forEach((p) => p.disconnect());
  return () => {
    for (const s of stops) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
  };
}
