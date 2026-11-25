// Plays a Schedule with Tone.js. One channel per voice (so each part can be
// soloed or muted), piano samples shared between them, and a click for the
// count-in. Calls back on every note start/end and bar, for follow-along.

import * as Tone from 'tone';
import type { VoiceId } from '../../../shared/model/types';
import type { Schedule } from '../../../shared/playback/schedule';
import { singingSounds } from '../../../shared/playback/vowels';
import { sing } from './voice';
import { SAMPLE_BASE, SAMPLE_NOTES, sampleFile } from './samples';

/** What plays the notes: the piano, the computer singer (sings the vowels of the words), or both. */
export type Instrument = 'piano' | 'voice' | 'both';
/** Piano loudness when it plays along with the singer. */
const PIANO_UNDER_VOICE = 0.35;

const VOICES: VoiceId[] = ['S', 'A', 'T', 'B'];

export interface PlayCallbacks {
  /** Called about 20 times a second with the playing position in seconds (negative during the count-in). */
  onTick: (seconds: number) => void;
  onEnd: () => void;
}

export interface PlayOptions {
  countIn: boolean;
  beatsPerBar: number;
  loop: boolean;
}

type PianoSound = Tone.Sampler | Tone.PolySynth;

export class ScorePlayer {
  private channels = new Map<VoiceId, Tone.Channel>();
  private instruments = new Map<VoiceId, PianoSound>();
  private singers = new Map<VoiceId, Tone.Gain>();
  private singing = new Set<() => void>();
  instrument: Instrument = 'piano';
  private click?: Tone.Synth;
  private loading?: Promise<'piano' | 'synth'>;
  private buffers?: Tone.ToneAudioBuffers;
  private ticker?: ReturnType<typeof setInterval>;
  sound: 'piano' | 'synth' | undefined;

  /** Load the piano sounds (once). Falls back to a simple synth if they can't be fetched. */
  load(): Promise<'piano' | 'synth'> {
    this.loading ??= new Promise((resolve) => {
      for (const v of VOICES) {
        const ch = new Tone.Channel({ volume: -8 }).toDestination();
        this.channels.set(v, ch);
        this.singers.set(v, new Tone.Gain(1).connect(ch));
      }
      this.click = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }, volume: -10 }).toDestination();
      const urls: Record<string, string> = {};
      for (const n of SAMPLE_NOTES) urls[n] = sampleFile(n);
      const useSynth = () => {
        for (const v of VOICES) {
          const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4 } });
          synth.connect(this.channels.get(v)!);
          this.instruments.set(v, synth);
        }
        this.sound = 'synth';
        resolve('synth');
      };
      const timer = setTimeout(useSynth, 20000);
      const buffers = (this.buffers = new Tone.ToneAudioBuffers({
        urls,
        baseUrl: SAMPLE_BASE,
        onload: () => {
          clearTimeout(timer);
          if (this.sound) return;
          for (const v of VOICES) {
            const map: Record<string, Tone.ToneAudioBuffer> = {};
            for (const n of SAMPLE_NOTES) map[n] = buffers.get(n);
            const sampler = new Tone.Sampler({ urls: map, release: 1 });
            sampler.connect(this.channels.get(v)!);
            this.instruments.set(v, sampler);
          }
          this.sound = 'piano';
          resolve('piano');
        },
        onerror: () => {
          clearTimeout(timer);
          if (!this.sound) useSynth();
        },
      }));
    });
    return this.loading;
  }

  setMute(v: VoiceId, mute: boolean) {
    const ch = this.channels.get(v);
    if (ch) ch.mute = mute;
  }

  setSolo(v: VoiceId, solo: boolean) {
    const ch = this.channels.get(v);
    if (ch) ch.solo = solo;
  }

  async play(schedule: Schedule, opts: PlayOptions, cb: PlayCallbacks) {
    await Tone.start(); // browsers (especially iPhone) only allow sound after a tap
    await this.load();
    this.stop();
    const transport = Tone.getTransport();
    const beat = schedule.startBeatSeconds;
    const offset = opts.countIn ? opts.beatsPerBar * beat : 0;

    if (opts.countIn) {
      for (let i = 0; i < opts.beatsPerBar; i++) {
        transport.schedule((t) => this.click?.triggerAttackRelease(i === 0 ? 'C6' : 'G5', 0.05, t), i * beat);
      }
    }
    const piano = this.instrument === 'voice' ? 0 : this.instrument === 'both' ? PIANO_UNDER_VOICE : 1;
    const sounds = this.instrument === 'piano' ? undefined : singingSounds(schedule.notes);
    const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
    for (const n of schedule.notes) {
      if (n.rest || !n.midi.length) continue;
      const inst = this.instruments.get(n.part);
      const freqs = n.midi.map((m) => Tone.Frequency(m, 'midi').toFrequency());
      const dur = Math.max(0.05, n.end - n.start);
      if (piano) transport.schedule((t) => inst?.triggerAttackRelease(freqs, dur, t, n.velocity * piano), offset + n.start);
      const sound = sounds?.get(n);
      const out = this.singers.get(n.part)?.input as unknown as AudioNode | undefined;
      if (sound && out) {
        transport.schedule((t) => {
          for (const freq of freqs) {
            const stop = sing(raw, out, { part: n.part, freq, start: t, dur, gain: n.velocity, ...sound });
            this.singing.add(stop);
            setTimeout(() => this.singing.delete(stop), (dur + 1) * 1000 + Math.max(0, t - raw.currentTime) * 1000);
          }
        }, offset + n.start);
      }
    }

    const end = offset + schedule.duration;
    transport.loop = opts.loop;
    if (opts.loop) {
      transport.loopStart = offset;
      transport.loopEnd = end;
    }
    // Follow-along: read the clock regularly instead of relying on per-note events,
    // so nothing is missed when the browser is busy or the tab is in the background.
    this.ticker = setInterval(() => {
      if (transport.state !== 'started') return;
      const t = transport.seconds - offset;
      cb.onTick(t);
      if (!opts.loop && t > schedule.duration + 0.4) {
        this.stop();
        cb.onEnd();
      }
    }, 50);
    transport.start('+0.1');
  }

  private silenceSinger() {
    for (const stop of this.singing) stop();
    this.singing.clear();
  }

  pause() {
    Tone.getTransport().pause();
    for (const i of this.instruments.values()) i.releaseAll();
    this.silenceSinger();
  }

  resume() {
    Tone.getTransport().start();
  }

  get state() {
    return Tone.getTransport().state;
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.loop = false;
    for (const i of this.instruments.values()) i.releaseAll();
    this.silenceSinger();
  }

  /**
   * Make an audio recording of the schedule without playing it (much faster than real time), with the
   * browser's own offline renderer: each voice at its own loudness (0 = left out), optional count-in.
   */
  async render(schedule: Schedule, opts: { countIn: boolean; beatsPerBar: number; gains: Record<VoiceId, number> }): Promise<AudioBuffer> {
    await this.load();
    const rate = 44100;
    const beat = schedule.startBeatSeconds;
    const offset = opts.countIn ? opts.beatsPerBar * beat : 0;
    const length = offset + schedule.duration + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(length * rate), rate);
    const master = ctx.createGain();
    master.gain.value = 0.4; // like the -8 dB channels used for playback
    master.connect(ctx.destination);
    const samples = this.sound === 'piano' && this.buffers
      ? SAMPLE_NOTES.map((n) => ({ midi: Tone.Frequency(n).toMidi(), buffer: this.buffers!.get(n).get() as AudioBuffer }))
      : [];
    const tone = (t: number, freq: number, dur: number, gain: number, type: OscillatorType, attack: number, release: number) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain, t + Math.max(attack, dur)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
      o.connect(g).connect(master); o.start(t); o.stop(t + Math.max(attack, dur) + release + 0.05);
    };
    if (opts.countIn) for (let i = 0; i < opts.beatsPerBar; i++) tone(i * beat, i === 0 ? 1046.5 : 784, 0.03, 0.5, 'triangle', 0.001, 0.08);
    const piano = this.instrument === 'voice' ? 0 : this.instrument === 'both' ? PIANO_UNDER_VOICE : 1;
    const sounds = this.instrument === 'piano' ? undefined : singingSounds(schedule.notes);
    // Each note is built just before it is needed while recording (a few seconds ahead): building all of
    // them at the start makes the browser work on thousands of silent sounds and takes minutes.
    const jobs: { start: number; build: () => void }[] = [];
    for (const n of schedule.notes) {
      const vg = opts.gains[n.part] ?? 0;
      if (n.rest || !n.midi.length || !(vg > 0)) continue;
      const t = offset + n.start;
      const dur = Math.max(0.05, n.end - n.start);
      const sound = sounds?.get(n);
      if (sound) for (const m of n.midi) jobs.push({ start: t, build: () => sing(ctx, master, { part: n.part, freq: 440 * 2 ** ((m - 69) / 12), start: t, dur, gain: vg * n.velocity, ...sound }) });
      if (!piano) continue;
      for (const m of n.midi) {
        const gain = vg * n.velocity * piano;
        if (!samples.length) { jobs.push({ start: t, build: () => tone(t, 440 * 2 ** ((m - 69) / 12), dur, gain * 0.5, 'triangle', 0.02, 0.4) }); continue; }
        const s = samples.reduce((a, b) => (Math.abs(b.midi - m) < Math.abs(a.midi - m) ? b : a));
        jobs.push({ start: t, build: () => {
          const src = ctx.createBufferSource(); src.buffer = s.buffer; src.playbackRate.value = 2 ** ((m - s.midi) / 12);
          const g = ctx.createGain();
          g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1);
          src.connect(g).connect(master); src.start(t); src.stop(t + dur + 1.05);
          src.onended = () => { src.disconnect(); g.disconnect(); };
        } });
      }
    }
    const AHEAD = 2;
    const chunks = new Map<number, (() => void)[]>();
    for (const j of jobs) {
      const c = Math.floor(j.start / AHEAD);
      if (!chunks.has(c)) chunks.set(c, []);
      chunks.get(c)!.push(j.build);
    }
    for (const [c, list] of chunks) {
      const build = () => list.forEach((b) => b());
      if (c === 0) build();
      else ctx.suspend((c * AHEAD * rate - ((c * AHEAD * rate) % 128) - 128 * 4) / rate).then(() => { build(); ctx.resume(); });
    }
    return ctx.startRendering();
  }
}
