import { describe, expect, it } from 'vitest';
import { decodeSongHash, encodeSongHash, findSongLink } from '../shared/share/link';
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

  describe('a link pasted into the score box', () => {
    it('finds the song in a whole link, with spaces, a message around it, or a line break after it', async () => {
      const text = fixture('old-hundredth.staff.txt');
      const hash = await encodeSongHash('staff', text);
      for (const pasted of [
        `https://soldierms.github.io/Tosingwell/${hash}`,
        `  https://soldierms.github.io/Tosingwell/${hash}\n`,
        `Old Hundredth — open this link to see, play and practise the song in Tosingwell:\nhttps://soldierms.github.io/Tosingwell/${hash}`,
        `http://localhost:5180/${hash}`,
      ]) {
        const found = findSongLink(pasted);
        expect(found).toEqual({ kind: 'song', hash });
        expect(await decodeSongHash(hash)).toEqual({ format: 'staff', text });
      }
    });
    it('spots a web address with no song in it (the song part lost when copying)', () => {
      expect(findSongLink('https://soldierms.github.io/Tosingwell/')).toEqual({ kind: 'address' });
      expect(findSongLink('  www.example.com/x \n')).toEqual({ kind: 'address' });
    });
    it('gives a cut-off song link that will not open (so the app can say so)', async () => {
      const hash = await encodeSongHash('staff', fixture('old-hundredth.staff.txt'));
      const found = findSongLink(`https://soldierms.github.io/Tosingwell/${hash.slice(0, 40)}`);
      expect(found?.kind).toBe('song');
      expect(await decodeSongHash((found as { hash: string }).hash)).toBeUndefined();
      expect(findSongLink('https://soldierms.github.io/Tosingwell/#song=t.')).toEqual({ kind: 'song', hash: '#song=t.' });
    });
    it('leaves ordinary score text alone, even with a web address in a comment or lyrics', () => {
      expect(findSongLink(fixture('old-hundredth.solfa.txt'))).toBeUndefined();
      expect(findSongLink(fixture('evening-song.staff.txt'))).toBeUndefined();
      expect(findSongLink('% from https://example.com/hymns\nS: | d :r |')).toBeUndefined();
      expect(findSongLink('')).toBeUndefined();
    });
  });
});
