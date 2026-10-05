// Photo-reading test: sends every image in tests/vision/ to Claude and compares
// what comes back with the correct answer, bar by bar. Uses the paid API, so it
// is NOT part of `npm test` — run it on purpose:
//
//   npm run test:vision                               (default model)
//   npm run test:vision -- --model claude-sonnet-5-5  (compare another model)
//
// Images and their correct answers:
//   tests/vision/<name>.<staff|solfa>.png  → answer tests/fixtures/<name>.<staff|solfa>.txt
//   or put a real photo as tests/vision/<anything>.jpg with its answer typed in
//   tests/vision/<anything>.expected.<staff|solfa>.txt

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MODEL, readScore } from '../server/read';
import { readingToText } from '../shared/vision/toText';
import { parseSolfa } from '../shared/solfa/parse';
import { parseStaffText } from '../shared/staff/parse';
import { barsOf } from '../tests/helpers';
import type { Score } from '../shared/model/types';

try {
  process.loadEnvFile('.env');
} catch {
  // handled below
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('No ANTHROPIC_API_KEY found. Copy .env.example to .env and add your key first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : process.env.READ_MODEL ?? DEFAULT_MODEL;
const DIR = 'tests/vision';
const parse = (text: string, format: string): Score => (format === 'solfa' ? parseSolfa(text) : parseStaffText(text));

function expectedFor(file: string): { path: string; format: 'staff' | 'solfa' } | undefined {
  const base = file.replace(/\.(png|jpe?g|webp)$/i, '');
  for (const f of ['staff', 'solfa'] as const) {
    const own = join(DIR, `${base}.expected.${f}.txt`);
    if (existsSync(own)) return { path: own, format: f };
  }
  const m = /^(.+)\.(staff|solfa)$/.exec(base);
  if (m) {
    const fx = join('tests/fixtures', `${m[1]}.${m[2]}.txt`);
    if (existsSync(fx)) return { path: fx, format: m[2] as 'staff' | 'solfa' };
  }
  return undefined;
}

const images = readdirSync(DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
let totalBars = 0;
let rightBars = 0;
let totalCost = 0;
const report: unknown[] = [];

console.log(`Reading ${images.length} image(s) with ${model}…\n`);
for (const file of images) {
  const exp = expectedFor(file);
  if (!exp) {
    console.log(`- ${file}: no correct answer found, skipped`);
    continue;
  }
  const data = readFileSync(join(DIR, file)).toString('base64');
  const mediaType = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
  const started = Date.now();
  try {
    const res = await readScore(data, mediaType, model);
    const conv = readingToText(res.reading);
    const got = parse(conv.text, conv.format);
    const want = parse(readFileSync(exp.path, 'utf8'), exp.format);
    const mistakes: string[] = [];
    let bars = 0;
    let right = 0;
    for (const v of want.parts.map((p) => p.id)) {
      const w = barsOf(want, v);
      const g = barsOf(got, v);
      w.forEach((bar, i) => {
        bars++;
        if (g[i] === bar) right++;
        else mistakes.push(`${v} bar ${i + 1}: expected "${bar}", read "${g[i] ?? '(missing)'}"`);
      });
    }
    totalBars += bars;
    rightBars += right;
    totalCost += res.usage.costUsd ?? 0;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${right === bars ? '✅' : '❌'} ${file}: ${right}/${bars} bars exactly right (${secs}s, $${res.usage.costUsd?.toFixed(3) ?? '?'})`);
    for (const m of mistakes) console.log(`     ${m}`);
    for (const n of conv.notes) console.log(`     note: ${n.message}`);
    report.push({ file, bars, right, mistakes, notes: conv.notes.map((n) => n.message), usage: res.usage });
  } catch (e) {
    console.log(`❌ ${file}: ${e instanceof Error ? e.message : String(e)}`);
    report.push({ file, error: String(e) });
  }
}

const pct = totalBars ? ((100 * rightBars) / totalBars).toFixed(1) : '0';
console.log(`\nOverall: ${rightBars}/${totalBars} bars exactly right (${pct}%) with ${model}. Total cost about $${totalCost.toFixed(2)}.`);
writeFileSync(join(DIR, `report-${model}.json`), JSON.stringify({ model, date: new Date().toISOString(), rightBars, totalBars, totalCost, report }, null, 2));
console.log(`Details saved to ${DIR}/report-${model}.json`);
