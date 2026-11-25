// The piano sounds: free Salamander Grand Piano samples, hosted by the Tone.js project.
// Shared by the player and by the offline service worker (vite.config.ts), which saves them on the
// device so playback works without internet.

export const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
export const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
/** File name of a note's sample: "D#1" → "Ds1.mp3". */
export const sampleFile = (note: string) => `${note.replace('#', 's')}.mp3`;
export const SAMPLE_URLS = SAMPLE_NOTES.map((n) => SAMPLE_BASE + sampleFile(n));
