// Plays a Schedule with Tone.js. One channel per voice (so each part can be
// soloed or muted), piano samples shared between them, and a click for the
// count-in. Calls back on every note start/end and bar, for follow-along.

import * as Tone from 'tone';
import type { VoiceId } from '../../../shared/model/types';
import type { Schedule } from '../../../shared/playback/schedule';

/** Free Salamander Grand Piano samples, hosted by the Tone.js project. */
const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
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

type Instrument = Tone.Sampler | Tone.PolySynth;

export class ScorePlayer {
  private channels = new Map<VoiceId, Tone.Channel>();
  private instruments = new Map<VoiceId, Instrument>();
  private click?: Tone.Synth;
  private loading?: Promise<'piano' | 'synth'>;
  private ticker?: ReturnType<typeof setInterval>;
  sound: 'piano' | 'synth' | undefined;

  /** Load the piano sounds (once). Falls back to a simple synth if they can't be fetched. */
  load(): Promise<'piano' | 'synth'> {
    this.loading ??= new Promise((resolve) => {
      for (const v of VOICES) this.channels.set(v, new Tone.Channel({ volume: -8 }).toDestination());
      this.click = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 }, volume: -10 }).toDestination();
      const urls: Record<string, string> = {};
      for (const n of SAMPLE_NOTES) urls[n] = `${n.replace('#', 's')}.mp3`;
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
      const buffers = new Tone.ToneAudioBuffers({
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
      });
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
    for (const n of schedule.notes) {
      if (n.rest || !n.midi.length) continue;
      const inst = this.instruments.get(n.part);
      const freqs = n.midi.map((m) => Tone.Frequency(m, 'midi').toFrequency());
      const dur = Math.max(0.05, n.end - n.start);
      transport.schedule((t) => inst?.triggerAttackRelease(freqs, dur, t, n.velocity), offset + n.start);
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

  pause() {
    Tone.getTransport().pause();
    for (const i of this.instruments.values()) i.releaseAll();
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
  }
}
