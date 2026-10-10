import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { parseSolfa } from '../../shared/solfa/parse';
import { parseStaffText } from '../../shared/staff/parse';
import { barBodyText, writeSolfa, writeSolfaParts } from '../../shared/solfa/write';
import { writeStaffText } from '../../shared/staff/write';
import { analyzeScore } from '../../shared/analysis/checks';
import { summarize } from '../../shared/analysis/summary';
import { EXAMPLES } from './examples';
import { StaffView } from './components/StaffView';
import { SolfaView } from './components/SolfaView';
import { SummaryPanel } from './components/SummaryPanel';
import { FlagsPanel } from './components/FlagsPanel';
import { PlayerPanel, type FollowState } from './components/PlayerPanel';
// The print window is loaded only when it is first opened.
const PrintDialog = lazy(() => import('./components/PrintDialog').then((m) => ({ default: m.PrintDialog })));
import { PhotoPanel, type ReadResponse } from './components/PhotoPanel';
import { PhotoView, type PhotoPage } from './components/PhotoView';
import { NoteEditor } from './components/NoteEditor';
import { continuePage, readingToText, withoutHeader } from '../../shared/vision/toText';
import { editNote, findEvent, type NoteEdit } from '../../shared/edit/editNote';
import type { Flag } from '../../shared/model/types';
import type { PreparedImage } from './vision/prepareImage';
import { FileBar } from './components/FileBar';
import { downloadText, loadDraft, looksLike, musicXmlFileName, saveDraft, scoreFileName } from './storage/library';
import { exportMusicXml } from '../../shared/musicxml/export';

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

// Optional address settings, e.g. ?example=2&view=solfa (used for tests and sharing).
const params = new URLSearchParams(location.search);
// Start with your last work (saved automatically), unless an example was asked for in the address.
const DRAFT = params.has('example') ? null : loadDraft();
const START = DRAFT ?? EXAMPLES[Number(params.get('example') ?? 0)] ?? EXAMPLES[0];
const START_VIEW = (['staff', 'solfa', 'both'].includes(params.get('view') ?? '') ? params.get('view') : 'both') as View;

export function App() {
  const [format, setFormat] = useState<Format>(START.format);
  const [text, setText] = useState(START.text);
  const [view, setView] = useState<View>(START_VIEW);
  const [photoPages, setPhotoPages] = useState<PhotoPage[]>([]);
  const [readingNotes, setReadingNotes] = useState<Flag[]>([]);
  const [selected, setSelected] = useState<string>();
  const [incomingImage, setIncomingImage] = useState<{ files: File[]; at: number }>();
  const [dragging, setDragging] = useState(false);
  const isPicture = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const takeImage = (file: File | File[]) => {
    setIncomingImage({ files: Array.isArray(file) ? file : [file], at: Date.now() });
    setTimeout(() => document.getElementById('photo')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };
  const [notice, setNotice] = useState<string | undefined>(DRAFT ? 'Your last work was restored.' : undefined);
  // Undo / redo of whole-score changes (note fixes, photo readings, opening files, examples).
  const [undoStack, setUndoStack] = useState<{ format: Format; text: string }[]>([]);
  const [redoStack, setRedoStack] = useState<{ format: Format; text: string }[]>([]);
  const [tenorClef, setTenorClef] = useState<'bass' | 'treble8vb'>('bass');
  const [converted, setConverted] = useState<Format>('staff');
  const [viewRef, width] = useWidth();
  const deferredText = useDeferredValue(text);
  const [follow, setFollow] = useState<FollowState>({ ids: new Set() });
  // Opening the page with #print in the address goes straight to the print window.
  const [printing, setPrinting] = useState<'print' | 'pdf' | undefined>(location.hash === '#print' ? 'print' : undefined);
  const closePrint = useCallback(() => setPrinting(undefined), []);
  const onFollow = useCallback((f: FollowState) => setFollow(f), []);

  // Follow-along: keep the note being played in view.
  useEffect(() => {
    const first = [...follow.ids][0];
    if (!first) return;
    const el = document.querySelector(`.score [data-note-id="${CSS.escape(first)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [follow.measure]);

  // Read the typed score → one Score model that everything below uses.
  const result = useMemo(() => {
    const score = format === 'solfa' ? parseSolfa(deferredText) : parseStaffText(deferredText);
    const checks = analyzeScore(score);
    const solfa = writeSolfa(score);
    const staff = writeStaffText(score);
    const flags = [...readingNotes, ...score.flags, ...checks, ...solfa.flags, ...staff.flags];
    const flaggedBars = new Set(flags.filter((f) => f.level === 'error' && f.measure !== undefined).map((f) => f.measure!));
    return { score, flags, flaggedBars, solfaText: solfa.text, staffText: staff.text, summary: summarize(score, flags) };
  }, [deferredText, format, readingNotes]);

  /** Replace the whole score, remembering the old one for Undo. */
  const replace = (nextFormat: Format, nextText: string) => {
    setUndoStack((u) => [...u.slice(-49), { format, text }]);
    setRedoStack([]);
    setFormat(nextFormat);
    setText(nextText);
  };
  // ?score=NAME opens a score file kept on this computer in app/public/_private/ (not in git:
  // private, copyrighted music), so one link shows the same checked score in any browser or phone.
  useEffect(() => {
    // Forgive a full stop or other punctuation copied along with the link (e.g. "?score=praise-him.").
    const raw = params.get('score');
    if (raw === null) return;
    const name = raw.trim().replace(/[^\w-]+$/, '').replace(/^[^\w-]+/, '');
    if (!/^[\w-]+$/.test(name)) {
      setNotice(`The link asks for a score called “${raw}”, which is not a valid name. Check the address.`);
      return;
    }
    (async () => {
      for (const f of ['staff', 'solfa'] as const) {
        const r = await fetch(`/_private/${name}.${f}.txt`).catch(() => undefined);
        const t = r?.ok ? await r.text() : '';
        if (!t.includes('Title:')) continue; // a missing file comes back as the app page
        replace(f, t);
        setNotice(`Opened “${t.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? name}” from the link. Press 💾 Save to keep it in My scores.`);
        return;
      }
      setNotice(`No score called “${name}” was found on this computer.`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, { format, text }]);
    setFormat(prev.format);
    setText(prev.text);
  };
  const redo = () => {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, { format, text }]);
    setFormat(next.format);
    setText(next.text);
  };
  // ⌘Z / Ctrl+Z (outside the text box, which has its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (typing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Save the work in progress automatically (on this device) — but only once something has
  // actually changed, so just opening a page (e.g. an example link) never replaces your saved work.
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) {
      if (text === START.text && format === START.format) return;
      changed.current = true;
    }
    const t = setTimeout(() => saveDraft(format, text), 800);
    return () => clearTimeout(t);
  }, [format, text]);

  const startFresh = (nextFormat: Format, nextText: string, message?: string) => {
    setPhotoPages([]);
    setReadingNotes([]);
    setSelected(undefined);
    replace(nextFormat, nextText);
    setConverted(nextFormat === 'solfa' ? 'staff' : 'solfa');
    setNotice(message);
  };
  const loadExample = (i: number) => startFresh(EXAMPLES[i].format, EXAMPLES[i].text);

  // Paste anywhere (outside the text boxes): a picture goes to the photo reader,
  // score text (lines starting S: A: T: B:) replaces the score — Undo brings the old one back.
  // Drag and drop works the same way for picture files and .txt score files.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement;
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const img = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (img) { e.preventDefault(); takeImage(img); return; }
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (/^\s*[SATB]\s*:/m.test(t)) {
        e.preventDefault();
        startFresh(looksLike(t) ?? 'solfa', t, 'Pasted the score. ↶ Undo brings back the previous one.');
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const all = [...(e.dataTransfer?.files ?? [])];
      const f = all[0];
      if (!f) return;
      const pics = all.filter(isPicture);
      if (pics.length) takeImage(pics);
      else if (/\.txt$/i.test(f.name) || f.type.startsWith('text/')) {
        const t = await f.text();
        startFresh(looksLike(t) ?? (/\.staff\.txt$/i.test(f.name) ? 'staff' : 'solfa'), t, `Opened ${f.name}. ↶ Undo brings back the previous score.`);
      }
    };
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragging(true); } };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    window.addEventListener('paste', onPaste);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
    };
  });

  /**
   * "Type in" changed: CONVERT the score to the other notation (it is the same music).
   * If the text already is in the chosen notation, just switch how it is read.
   */
  const changeFormat = (next: Format) => {
    if (next === format) return;
    if (looksLike(text) === next) {
      setFormat(next);
      setNotice(`Now reading the text as ${next === 'solfa' ? 'Tonic Sol-fa' : 'staff notation'}.`);
      return;
    }
    replace(next, next === 'solfa' ? result.solfaText : result.staffText);
    setNotice(`Converted the score to ${next === 'solfa' ? 'Tonic Sol-fa' : 'staff notation (as text)'}. Undo brings the old text back.`);
  };

  // The text clearly does not match the "Type in" choice (e.g. sol-fa read as staff).
  const mismatch = looksLike(deferredText);
  const wrongFormat = mismatch && mismatch !== format ? mismatch : undefined;

  const convertedText = converted === 'solfa' ? result.solfaText : result.staffText;

  // A photo was read: put the reading into the editor (or add it as the next page).
  // Several pages can be read one after another before React re-renders, so keep the
  // newest score text here and build each next page on top of it.
  const latest = useRef({ format, text });
  latest.current = { format, text };
  const onRead = (res: ReadResponse, image: PreparedImage, mode: 'new' | 'append') => {
    const cur = latest.current;
    const curMeasures = mode === 'append' ? (cur.format === 'solfa' ? parseSolfa(cur.text) : parseStaffText(cur.text)).measures : [];
    const last = curMeasures[curMeasures.length - 1];
    const conv = readingToText(mode === 'append' ? continuePage(res.reading, last) : res.reading);
    const regions = res.reading.parts[0]?.bars.map((b) => b.region) ?? [];
    if (mode === 'append' && conv.format === cur.format) {
      const firstBar = curMeasures.length;
      const nextText = `${cur.text.trimEnd()}\n${withoutHeader(conv.text)}`;
      latest.current = { format: cur.format, text: nextText };
      replace(cur.format, nextText);
      setPhotoPages((p) => [...p, { url: image.url, regions, firstBar }]);
      setReadingNotes((n) => [...n, ...conv.notes.map((f) => ({ ...f, measure: f.measure === undefined ? undefined : f.measure + firstBar }))]);
    } else {
      latest.current = { format: conv.format, text: conv.text };
      replace(conv.format, conv.text);
      setConverted(conv.format === 'solfa' ? 'staff' : 'solfa');
      setPhotoPages([{ url: image.url, regions, firstBar: 0 }]);
      setReadingNotes(conv.notes);
    }
    setSelected(undefined);
  };

  // A fix from the note editor: change the score, then write it back as text.
  const onEdit = (edit: NoteEdit) => {
    if (!selected) return;
    const next = editNote(result.score, selected, edit);
    replace(format, format === 'solfa' ? writeSolfa(next).text : writeStaffText(next).text);
    if (edit.type === 'delete') setSelected(undefined);
  };
  const selectedFound = selected ? findEvent(result.score, selected) : undefined;
  const selectedBar = selectedFound?.bar;
  const selectedBarText = useMemo(() => {
    if (!selectedFound) return '';
    const sp = writeSolfaParts(result.score).parts.find((p) => p.voice === selectedFound.part.id);
    const bar = sp?.bars[selectedFound.bar];
    return bar ? barBodyText(bar) : '';
  }, [result.score, selectedFound?.part.id, selectedFound?.bar]);

  // A whole bar typed in sol-fa: rebuild the score with that bar replaced.
  const onBarEdit = (newText: string): string | undefined => {
    if (!selectedFound) return;
    const voice = selectedFound.part.id;
    const b = selectedFound.bar;
    const full = writeSolfa(result.score, new Map([[`${voice}:${b}`, newText.replace(/\|/g, ' ').trim()]])).text;
    const check = parseSolfa(full);
    const problems = check.flags.filter((f) => f.level === 'error' && f.part === voice && f.measure === b);
    if (problems.length) return `Not applied: ${problems.map((f) => f.message.replace(/^.*?bar \d+: /, '')).join(' ')}`;
    replace(format, format === 'solfa' ? full : writeStaffText(check).text);
    const len = analyzeScore(check).find((f) => f.code === 'bar-length' && f.part === voice && f.measure === b);
    return len ? `Applied, but: ${len.message.replace(/^.*?bar \d+: /, '')}` : 'Applied. The staff notation now matches.';
  };
  // Beside the photo on a wide screen, the music gets the remaining width.
  const musicWidth = photoPages.length && width >= 1000 ? Math.floor(width * 0.6) - 16 : width - 2;
  const highlight = useMemo(() => (selected ? new Set([...follow.ids, selected]) : follow.ids), [follow.ids, selected]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Tosingwell</h1>
        <p className="tagline">Tonic Sol-fa ⇄ Staff notation</p>
        <nav className="jump" aria-label="Go to">
          <a href="#type">Type</a>
          <a href="#photo">Photo</a>
          <a href="#play">Play</a>
          <a href="#score">Score</a>
        </nav>
      </header>
      {dragging && <div className="drop-overlay">Drop a picture of a score, or a .txt score file</div>}
      {notice && (
        <p className="notice" role="status">
          {notice} <button className="link" onClick={() => setNotice(undefined)}>OK</button>
        </p>
      )}

      <main className="layout">
        <section className="card editor" id="type">
          <FileBar
            title={result.score.meta.title}
            format={format}
            text={text}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undo}
            onRedo={redo}
            onLoad={(f, t, how) => startFresh(f, t, how)}
            onDownload={() => downloadText(scoreFileName(result.score.meta.title, format), text)}
            onPasteImage={takeImage}
            onMusicXml={() =>
              downloadText(musicXmlFileName(result.score.meta.title), exportMusicXml(result.score, { tenorClef }), 'application/vnd.recordare.musicxml+xml')
            }
          />
          <div className="row">
            <label>
              Type in:{' '}
              <select value={format} onChange={(e) => changeFormat(e.target.value as Format)}>
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
          {wrongFormat && (
            <p className="warning-text">
              ⚠️ This text looks like {wrongFormat === 'solfa' ? 'Tonic Sol-fa' : 'staff notation'}, but “Type in” is set to{' '}
              {format === 'solfa' ? 'Tonic Sol-fa' : 'staff notation'}.{' '}
              <button onClick={() => { setFormat(wrongFormat); setNotice(undefined); }}>
                Read it as {wrongFormat === 'solfa' ? 'sol-fa' : 'staff notation'}
              </button>
            </p>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={14} aria-label="Score text" />
          <FormatHelp format={format} />
        </section>

        <SummaryPanel summary={result.summary} />
        <FlagsPanel flags={result.flags} />
        <PhotoPanel canAppend={photoPages.length > 0} onRead={onRead} incoming={incomingImage} />
        <PlayerPanel score={result.score} errorCount={result.summary.counts.error} onFollow={onFollow} />

        <section className="card score" ref={viewRef} id="score">
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
            <span className="spacer" />
            <button onClick={() => setPrinting('print')}>🖨 Print</button>
            <button onClick={() => setPrinting('pdf')}>⬇ Export PDF</button>
          </div>
          <div className={photoPages.length ? 'review' : undefined}>
          {photoPages.length > 0 && <PhotoView pages={photoPages} bar={selectedBar} />}
          <div className="review-music">
          <h2 className="score-title">{result.score.meta.title}</h2>
          {result.score.meta.composer && <p className="composer">{result.score.meta.composer}</p>}
          {(view === 'staff' || view === 'both') && (
            <StaffView score={result.score} width={musicWidth} tenorClef={tenorClef} flaggedBars={result.flaggedBars} highlight={highlight} onNoteClick={setSelected} />
          )}
          {(view === 'solfa' || view === 'both') && (
            <SolfaView score={result.score} width={musicWidth} flaggedBars={result.flaggedBars} highlight={highlight} onNoteClick={setSelected} />
          )}
          </div>
          </div>
        </section>

        <section className="card converted">
          <div className="row">
            <h2>Converted text</h2>
            <div className="segmented" role="group" aria-label="Converted format">
              <button className={converted === 'solfa' ? 'on' : ''} onClick={() => setConverted('solfa')}>Sol-fa</button>
              <button className={converted === 'staff' ? 'on' : ''} onClick={() => setConverted('staff')}>Staff text</button>
            </div>
            <button onClick={() => navigator.clipboard.writeText(convertedText)}>Copy</button>
            <button onClick={() => replace(converted, convertedText)}>Edit this version</button>
          </div>
          <pre>{convertedText}</pre>
        </section>
      </main>
      {selected && (
        <NoteEditor
          key={selected}
          score={result.score}
          id={selected}
          onEdit={onEdit}
          barText={selectedBarText}
          onBarEdit={onBarEdit}
          onClose={() => setSelected(undefined)}
        />
      )}
      {printing && (
        <Suspense fallback={<p className="notice">Opening the print window…</p>}>
          <PrintDialog score={result.score} notation={view} tenorClef={tenorClef} mode={printing} onClose={closePrint} />
        </Suspense>
      )}
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
          <li>Octaves: <code>d'</code> higher, <code>d,</code> lower (or <code>d₁</code>). The bass is written an octave above how it sounds; the tenor at its real pitch.</li>
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
