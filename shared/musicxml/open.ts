// Opening a MusicXML file (from MuseScore, Finale, Sibelius, Dorico, Audiveris…) as a Tosingwell score.
// .musicxml / .xml are plain text; .mxl is the compressed form (a zip with the music inside).
// The music goes through the same path as a photo reading: musicXmlToReading → readingToText → typed
// staff text, so the normal parser, checks and views all work on it. Runs in the browser and in Node.

import { musicXmlToReading } from './import';
import { readingToText } from '../vision/toText';
import type { Flag } from '../model/types';

export interface OpenedMusicXml {
  format: 'staff' | 'solfa';
  text: string;
  /** Things to check (piano part left out, short bars…), shown with the checks. */
  notes: Flag[];
}

export const isMusicXmlName = (name: string) => /\.(musicxml|mxl|xml)$/i.test(name);

/** A title from the file name: "Ka_Kyere-Yesu.mxl" → "Ka Kyere Yesu". */
const titleFromName = (name: string) =>
  name.replace(/^.*[\\/]/, '').replace(/\.(musicxml|mxl|xml)$/i, '').replace(/[_-]+/g, ' ').trim();

/** Turns the bytes of a MusicXML file into staff text. Throws an Error with a plain message if it can't. */
export async function openMusicXml(name: string, bytes: Uint8Array): Promise<OpenedMusicXml> {
  const xml = isZip(bytes) ? await xmlFromMxl(bytes) : decodeText(bytes);
  if (!/<score-(partwise|timewise)\b/.test(xml)) {
    throw new Error(`${name} is not a MusicXML score. Export it again from your music program as “MusicXML”.`);
  }
  const reading = musicXmlToReading(xml);
  if (reading.notation === 'not-music' || !reading.parts.length) {
    throw new Error(`No singable parts were found in ${name}. ${reading.photoProblems.join(' ')}`.trim());
  }
  reading.reader = 'file';
  // The importer was written for Audiveris pages; in a real file a missing title is just missing.
  if (!reading.title?.trim()) reading.title = titleFromName(name) || null;
  reading.photoProblems = [];
  const conv = readingToText(reading);
  return { format: conv.format, text: conv.text, notes: conv.notes.map((f) => ({ ...f, message: f.message.replace(/^Please check: /, '') })) };
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** MusicXML may be UTF-8 or (from some programs) UTF-16 with a byte-order mark. */
function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
}

// ---------- .mxl = zip ----------

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

/** Reads the zip's central directory (the list of files at the end). */
function zipEntries(b: Uint8Array): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This .mxl file is damaged (it is not a complete zip file).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This .mxl file is damaged.');
    const method = v.getUint16(p + 10, true);
    const compressedSize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function unzipEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const data = b.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('This .mxl file uses a compression this app cannot open. Export it as uncompressed MusicXML (.musicxml).');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  return new Uint8Array(await out.arrayBuffer());
}

async function xmlFromMxl(b: Uint8Array): Promise<string> {
  const entries = zipEntries(b);
  const byName = new Map(entries.map((e) => [e.name, e]));
  // META-INF/container.xml names the main score; fall back to the first .musicxml/.xml outside META-INF.
  let root: ZipEntry | undefined;
  const container = byName.get('META-INF/container.xml');
  if (container) {
    const path = /full-path="([^"]+)"/.exec(decodeText(await unzipEntry(b, container)))?.[1];
    if (path) root = byName.get(path);
  }
  root ??= entries.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
  if (!root) throw new Error('No music was found inside this .mxl file.');
  return decodeText(await unzipEntry(b, root));
}
