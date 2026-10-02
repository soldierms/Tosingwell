import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { parseSolfa } from '../../shared/solfa/parse';
import { parseStaffText } from '../../shared/staff/parse';
import { writeSolfa } from '../../shared/solfa/write';
import { writeStaffText } from '../../shared/staff/write';
import { analyzeScore } from '../../shared/analysis/checks';
import { summarize } from '../../shared/analysis/summary';
import { EXAMPLES } from './examples';
import { StaffView } from './components/StaffView';
import { SolfaView } from './components/SolfaView';
import { SummaryPanel } from './components/SummaryPanel';
import { FlagsPanel } from './components/FlagsPanel';

type Format = 'solfa' | 'staff';
type View = 'staff' | 'solfa' | 'both';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function App() {
  const [format, setFormat] = useState<Format>(EXAMPLES[0].format);
  const [text, setText] = useState(EXAMPLES[0].text);
  const [view, setView] = useState<View>('both');
  const [tenorClef, setTenorClef] = useState<'bass' | 'treble8vb'>('bass');
  const [converted, setConverted] = useState<Format>('staff');
  const [viewRef, width] = useWidth();
  const deferredText = useDeferredValue(text);

  // Read the typed score → one Score model that everything below uses.
  const result = useMemo(() => {
    const score = format === 'solfa' ? parseSolfa(deferredText) : parseStaffText(deferredText);
    const checks = analyzeScore(score);
    const solfa = writeSolfa(score);
    const staff = writeStaffText(score);
    const flags = [...score.flags, ...checks, ...solfa.flags, ...staff.flags];
    const flaggedBars = new Set(flags.filter((f) => f.level === 'error' && f.measure !== undefined).map((f) => f.measure!));
    return { score, flags, flaggedBars, solfaText: solfa.text, staffText: staff.text, summary: summarize(score, flags) };
  }, [deferredText, format]);

  const loadExample = (i: number) => {
    setFormat(EXAMPLES[i].format);
    setText(EXAMPLES[i].text);
    setConverted(EXAMPLES[i].format === 'solfa' ? 'staff' : 'solfa');
  };

  const convertedText = converted === 'solfa' ? result.solfaText : result.staffText;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Tosingwell</h1>
        <p className="tagline">Tonic Sol-fa ⇄ Staff notation</p>
      </header>

      <main className="layout">
        <section className="card editor">
          <div className="row">
            <label>
              Type in:{' '}
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="solfa">Tonic Sol-fa</option>
                <option value="staff">Staff notation (as text)</option>
              </select>
            </label>
            <label>
              Example:{' '}
              <select value="" onChange={(e) => e.target.value && loadExample(Number(e.target.value))}>
                <option value="">Choose…</option>
                {EXAMPLES.map((ex, i) => <option key={i} value={i}>{ex.name}</option>)}
              </select>
            </label>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={14} aria-label="Score text" />
          <FormatHelp format={format} />
        </section>

        <SummaryPanel summary={result.summary} />
        <FlagsPanel flags={result.flags} />

        <section className="card score" ref={viewRef}>
          <div className="row">
            <div className="segmented" role="group" aria-label="Notation">
              {(['staff', 'solfa', 'both'] as View[]).map((v) => (
                <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                  {v === 'staff' ? 'Staff' : v === 'solfa' ? 'Sol-fa' : 'Both'}
                </button>
              ))}
            </div>
            <label>
              Tenor:{' '}
              <select value={tenorClef} onChange={(e) => setTenorClef(e.target.value as 'bass' | 'treble8vb')}>
                <option value="bass">bass staff (with Bass)</option>
                <option value="treble8vb">own staff, octave-treble clef</option>
              </select>
            </label>
          </div>
          <h2 className="score-title">{result.score.meta.title}</h2>
          {result.score.meta.composer && <p className="composer">{result.score.meta.composer}</p>}
          {(view === 'staff' || view === 'both') && (
            <StaffView score={result.score} width={width - 2} tenorClef={tenorClef} flaggedBars={result.flaggedBars} />
          )}
          {(view === 'solfa' || view === 'both') && <SolfaView score={result.score} width={width - 2} flaggedBars={result.flaggedBars} />}
        </section>

        <section className="card converted">
          <div className="row">
            <h2>Converted text</h2>
            <div className="segmented" role="group" aria-label="Converted format">
              <button className={converted === 'solfa' ? 'on' : ''} onClick={() => setConverted('solfa')}>Sol-fa</button>
              <button className={converted === 'staff' ? 'on' : ''} onClick={() => setConverted('staff')}>Staff text</button>
            </div>
            <button onClick={() => navigator.clipboard.writeText(convertedText)}>Copy</button>
            <button onClick={() => { setFormat(converted); setText(convertedText); }}>Edit this version</button>
          </div>
          <pre>{convertedText}</pre>
        </section>
      </main>
    </div>
  );
}

function FormatHelp({ format }: { format: Format }) {
  return (
    <details className="help">
      <summary>How to type {format === 'solfa' ? 'sol-fa' : 'staff notation'}</summary>
      <p>
        Start with header lines: <code>Title: …</code> <code>Key: G</code> (or <code>Key: E minor</code>) <code>Time: 3/4</code>{' '}
        <code>Tempo: Andante q=72</code>. Then one line per voice starting <code>S:</code> <code>A:</code> <code>T:</code>{' '}
        <code>B:</code> (repeat the label to continue on another line), and lyrics with <code>S-lyrics:</code>.
      </p>
      {format === 'solfa' ? (
        <ul>
          <li><code>|</code> bar line · <code>:</code> next beat · <code>.</code> half beat · <code>,</code> quarter beat · <code>-</code> hold · blank = rest</li>
          <li><code>d r m f s l t</code> · chromatic <code>de ra ri me fe se le li ta</code> (also <code>fi si te</code>)</li>
          <li>Octaves: <code>d'</code> higher, <code>d,</code> lower (or <code>d₁</code>). Tenor and bass are written an octave above how they sound.</li>
          <li><code>d.,r</code> = dotted rhythm · <code>d.r.m</code> = triplet · <code>m+d</code> = two notes together (divisi)</li>
          <li>Key change with a bridge note: <code>[key:D]s/d</code></li>
        </ul>
      ) : (
        <ul>
          <li>Notes: <code>G4q</code> = G above middle C, quarter. Lengths <code>w h q e s t</code>, dots <code>q.</code> <code>q..</code></li>
          <li>Accidentals as printed: <code>F#4</code> <code>Bb3</code> <code>Fn4</code> (natural). The key signature applies automatically.</li>
          <li>Rests <code>rq</code>, whole-bar rest <code>R</code> · tie <code>G4h~ G4q</code> · chord <code>&lt;G4 B4&gt;q</code> · triplet <code>(3 C4e D4e E4e)</code> · grace <code>gD5s</code></li>
          <li>Type the pitch as it SOUNDS (tenor middle C is C4).</li>
        </ul>
      )}
      <ul>
        <li>Bar lines: <code>||:</code> <code>:||</code> repeats · <code>||</code> double · <code>|]</code> end</li>
        <li>Instructions: <code>[ending:1]</code> <code>[ending:2]</code> <code>[segno]</code> <code>[coda]</code> <code>[tocoda]</code> <code>[fine]</code> <code>[D.C. al Fine]</code> <code>[D.S. al Coda]</code> <code>[rit]</code> <code>[accel]</code> <code>[a tempo]</code> <code>[time:6/8]</code> <code>[tempo:q=60]</code></li>
        <li>Marks after a note: <code>{'{p}'}</code> <code>{'{ff}'}</code> <code>{'{stacc}'}</code> <code>{'{acc}'}</code> <code>{'{ten}'}</code> <code>{'{ferm}'}</code> <code>{'{cresc}'}</code> <code>{'{dim}'}</code> <code>{'{/hp}'}</code> (end hairpin) <code>{'{(}'}</code> <code>{'{)}'}</code> (slur)</li>
        <li>Lyrics: <code>A-bide with me</code> — hyphens join syllables, <code>_</code> holds a syllable over the next note, <code>*</code> skips a note.</li>
      </ul>
    </details>
  );
}
