import { describe, expect, it } from 'vitest';
import { decodeSongHash, encodeSongHash } from '../shared/share/link';
import { fixture } from './helpers';

describe('song links', () => {
  it('packs a score into a link and back, unchanged', async () => {
    const text = fixture('evening-song.solfa.txt') + '\nS-lyrics: Ɔ yɛ mɔbɔ hu fo — Twe-duam-pɔn\n';
    const hash = await encodeSongHash('solfa', text);
    expect(hash).toMatch(/^#song=s\.[A-Za-z0-9_-]+$/);
    expect(await decodeSongHash(hash)).toEqual({ format: 'solfa', text });
  });
  it('keeps a long four-part score short enough to send', async () => {
    const text = fixture('evening-song.staff.txt').repeat(8);
    const hash = await encodeSongHash('staff', text);
    expect(hash.length).toBeLessThan(text.length / 2);
  });
  it('ignores damaged or unrelated links', async () => {
    expect(await decodeSongHash('#print')).toBeUndefined();
    expect(await decodeSongHash('#song=s.@@@')).toBeUndefined();
    expect(await decodeSongHash('#song=s.AAAA')).toBeUndefined();
  });
});
