// Reads a page with Audiveris (free, open-source music reading program, installed on this Mac).
// Audiveris is built for PRINTED staff notation: it writes MusicXML, which shared/musicxml/import.ts
// turns into the same "reading" the AI readers produce. Sol-fa and handwriting are not its job:
// when it finds no staff music, provider.ts can pass the page on to Gemini/Claude.
//
// Setup: install Audiveris (https://github.com/Audiveris/audiveris/releases) into /Applications or
// ~/Applications, or set AUDIVERIS_PATH in .env to the program inside the app
// (…/Audiveris.app/Contents/MacOS/Audiveris).

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { musicXmlToReading } from '../shared/musicxml/import';
import { ReadError, type ReadResult } from './read';

const run = promisify(execFile);

export function audiverisPath(): string | undefined {
  const candidates = [
    process.env.AUDIVERIS_PATH,
    '/Applications/Audiveris.app/Contents/MacOS/Audiveris',
    join(homedir(), 'Applications/Audiveris.app/Contents/MacOS/Audiveris'),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

/** Staff lines in phone photos and screenshots are often too close together for Audiveris; it reads best
 *  with large pictures, so small ones are enlarged first (macOS `sips`). */
const MIN_SHORT_EDGE = 1600;
const MAX_PIXELS = 18_000_000;

export async function readScoreAudiveris(imageBase64: string, mediaType: string): Promise<ReadResult> {
  const exe = audiverisPath();
  if (!exe) throw new ReadError('Audiveris is not installed. See the README (photo reading → Audiveris).', 503);
  const dir = await mkdtemp(join(tmpdir(), 'tosingwell-omr-'));
  try {
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
    let input = join(dir, `page.${ext}`);
    await writeFile(input, Buffer.from(imageBase64, 'base64'));
    try {
      const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', input]);
      const [w, h] = [...stdout.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1]));
      const long = Math.max(w, h);
      // Up to twice the size, but below Audiveris's limit of 20 million pixels.
      const scale = Math.min(2, Math.sqrt(MAX_PIXELS / (w * h)));
      // Only narrow pictures (screenshots, several pages stacked) need it; enlarging a good page makes it worse.
      if (long > 0 && Math.min(w, h) < MIN_SHORT_EDGE && scale > 1.1) {
        const big = join(dir, 'page-big.png');
        await run('sips', ['-s', 'format', 'png', '-Z', String(Math.floor(long * scale)), input, '--out', big]);
        input = big;
      }
    } catch {
      // No sips (not macOS): read the picture as it is.
    }
    try {
      await run(exe, ['-batch', '-export', '-output', dir, '--', input], { timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      const err = e as { killed?: boolean; stderr?: string };
      if (err.killed) throw new ReadError('Audiveris took too long on this page (over 5 minutes).', 504);
      // Audiveris may still have written a result; carry on and look for it.
    }
    const mxl = (await readdir(dir)).filter((f) => f.endsWith('.mxl')).sort();
    if (!mxl.length) {
      return { reading: emptyReading('Audiveris found no staff notation on this page.'), model: 'Audiveris', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    }
    const file = join(dir, mxl[0]);
    const { stdout: container } = await run('unzip', ['-p', file, 'META-INF/container.xml']);
    const root = /full-path="([^"]+)"/.exec(container)?.[1];
    if (!root) throw new ReadError('Audiveris wrote a file this app could not open.', 500);
    const { stdout: xml } = await run('unzip', ['-p', file, root], { maxBuffer: 64 * 1024 * 1024 });
    const reading = musicXmlToReading(xml);
    if (mxl.length > 1) reading.questions.push('Audiveris split this page into several pieces; only the first was read.');
    return { reading, model: 'Audiveris', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function emptyReading(problem: string): ReadResult['reading'] {
  return { notation: 'not-music', title: null, composer: null, key: null, time: null, tempo: null, parts: [], questions: [], photoProblems: [problem], reader: 'audiveris' };
}
