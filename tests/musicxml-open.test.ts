// Opening MusicXML files (from MuseScore, Finale, Sibelius…): .musicxml/.xml text and compressed .mxl.
import { describe, expect, it } from 'vitest';
import { openMusicXml } from '../shared/musicxml/open';
import { exportMusicXml } from '../shared/musicxml/export';
import { parseStaffText } from '../shared/staff/parse';
import { parseSolfa } from '../shared/solfa/parse';
import { analyzeScore } from '../shared/analysis/checks';
import { barsOf, fixture, lyricsOf } from './helpers';

const bytes = (s: string) => new TextEncoder().encode(s);

/** A minimal .mxl (zip) holding the given files; `deflate` compresses them like real programs do. */
async function zip(files: Record<string, string>, deflate = true): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = bytes(text);
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const n = bytes(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, n.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, deflate ? 8 : 0, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, n.length, true);
    cd.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(cd.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const CONTAINER = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

describe('opening MusicXML files', () => {
  for (const name of ['old-hundredth.staff.txt', 'evening-song.staff.txt']) {
    it(`gives back every note and lyric of ${name} after a trip through MusicXML`, async () => {
      const original = parseStaffText(fixture(name));
      const opened = await openMusicXml('song.musicxml', bytes(exportMusicXml(original)));
      expect(opened.format).toBe('staff');
      const back = parseStaffText(opened.text);
      expect(back.meta.title).toBe(original.meta.title);
      expect(back.measures.length).toBe(original.measures.length);
      for (const v of ['S', 'A', 'T', 'B']) {
        expect(barsOf(back, v), `voice ${v}`).toEqual(barsOf(original, v));
        expect(lyricsOf(back, v), `lyrics ${v}`).toEqual(lyricsOf(original, v));
      }
      expect([...back.flags, ...analyzeScore(back)].filter((f) => f.level === 'error')).toEqual([]);
      // A real file is exact: no "the reader may have copied bars / was too sure" photo warnings.
      expect(opened.notes.map((n) => n.message).join('\n')).not.toMatch(/copies of other bars|completely sure/);
    });
  }

  it('opens a compressed .mxl file (deflated, as MuseScore saves it) and a stored one', async () => {
    const original = parseStaffText(fixture('old-hundredth.staff.txt'));
    const xml = exportMusicXml(original);
    for (const deflate of [true, false]) {
      const mxl = await zip({ 'META-INF/container.xml': CONTAINER, 'score.musicxml': xml }, deflate);
      const back = parseStaffText((await openMusicXml('Old Hundredth.mxl', mxl)).text);
      expect(barsOf(back, 'S')).toEqual(barsOf(original, 'S'));
      expect(barsOf(back, 'B')).toEqual(barsOf(original, 'B'));
    }
  });

  it('finds the music in an .mxl without a container file', async () => {
    const original = parseStaffText(fixture('old-hundredth.staff.txt'));
    const mxl = await zip({ 'hymn.xml': exportMusicXml(original) });
    expect(barsOf(parseStaffText((await openMusicXml('x.mxl', mxl)).text), 'A')).toEqual(barsOf(original, 'A'));
  });

  it('reads UTF-16 files (some programs save them that way)', async () => {
    const xml = exportMusicXml(parseStaffText(fixture('old-hundredth.staff.txt')));
    const u16 = new Uint8Array(2 + xml.length * 2);
    u16.set([0xff, 0xfe]);
    for (let i = 0; i < xml.length; i++) { u16[2 + i * 2] = xml.charCodeAt(i) & 0xff; u16[3 + i * 2] = xml.charCodeAt(i) >> 8; }
    expect((await openMusicXml('x.musicxml', u16)).text).toMatch(/^S: \|/m);
  });

  it('uses the file name as the title when the file has none', async () => {
    const xml = exportMusicXml(parseStaffText(fixture('old-hundredth.staff.txt'))).replace(/<work>[\s\S]*?<\/work>|<movement-title>[^<]*<\/movement-title>/g, '');
    const opened = await openMusicXml('Ka_Kyere-Yesu.musicxml', bytes(xml));
    expect(parseStaffText(opened.text).meta.title).toBe('Ka Kyere Yesu');
  });

  it('converts an opened file to sol-fa like any other score', async () => {
    const opened = await openMusicXml('x.musicxml', bytes(exportMusicXml(parseStaffText(fixture('old-hundredth.staff.txt')))));
    const solfa = parseSolfa(fixture('old-hundredth.solfa.txt'));
    expect(barsOf(parseStaffText(opened.text), 'S')).toEqual(barsOf(solfa, 'S'));
  });

  it('says plainly when a file is not music, or a zip is damaged', async () => {
    await expect(openMusicXml('notes.xml', bytes('<?xml version="1.0"?><shopping><item>rice</item></shopping>'))).rejects.toThrow(/not a MusicXML score/);
    await expect(openMusicXml('broken.mxl', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]))).rejects.toThrow(/damaged/);
  });
});
