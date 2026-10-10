// "Read a photo": take or choose pictures of a score (or a PDF), check their
// quality, send them one page at a time to the server, and hand each reading to
// the app. Several pages (or every page of a PDF) are read in order as one song;
// if the free reading limit is reached, the queue pauses and can be resumed.

import { useEffect, useRef, useState } from 'react';
import type { ScoreReading } from '../../../shared/vision/schema';
import { MAX_EDGE_AUDIVERIS, prepareImage, splitPicture, PHOTO_TIPS, type PreparedImage } from '../vision/prepareImage';

export interface ReadResponse {
  reading: ScoreReading;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
  readingId?: string;
}

/** Readings already put into the app on this page (so a missed one can be offered once). */
const SEEN_KEY = 'tosingwell.readingsLoaded';
const markSeen = (id?: string) => {
  if (!id) return;
  try {
    const seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-20)));
  } catch {
    // ignore
  }
};
const wasSeen = (id: string) => {
  try {
    return (JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
};

interface Props {
  /** True when the current score came from a photo, so a next page can be added. */
  canAppend: boolean;
  onRead: (res: ReadResponse, image: PreparedImage, mode: 'new' | 'append') => void;
  /** A picture pasted or dropped anywhere on the page. */
  incoming?: { files: File[]; at: number };
}

const HALVES_KEY = 'tosingwell.photo-halves';

export function PhotoPanel({ canAppend, onRead, incoming }: Props) {
  const [status, setStatus] = useState<{ ready: boolean; model: string; provider: 'audiveris' | 'gemini' | 'claude'; note?: string } | 'offline'>();
  /** Pages waiting to be read, in order. */
  const [pages, setPages] = useState<(PreparedImage & { name: string })[]>([]);
  /** How many of `pages` have been read into the app. */
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<string>();
  const [seconds, setSeconds] = useState(0);
  const [waitUntil, setWaitUntil] = useState<number>();
  const [error, setError] = useState<string>();
  const [last, setLast] = useState<string>();
  const [missed, setMissed] = useState<{ id: string; at: string; title: string | null }>();
  /** Cut each page into halves before reading (more detail per note). Remembered on this device. */
  const [halves, setHalves] = useState(() => {
    try {
      return localStorage.getItem(HALVES_KEY) !== 'no';
    } catch {
      return true;
    }
  });
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  // A reading that finished while this page was reloading (or the phone was locked)?
  useEffect(() => {
    fetch('/api/last-reading')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.available && !wasSeen(d.id) && Date.now() - Date.parse(d.at) < 2 * 60 * 60 * 1000) setMissed(d);
      })
      .catch(() => {});
  }, []);

  const loadMissed = async () => {
    try {
      const d = await (await fetch('/api/last-reading/full')).json();
      const url = `data:${d.mediaType};base64,${d.image}`;
      const img: PreparedImage = { base64: d.image, mediaType: 'image/jpeg', url, width: 0, height: 0, warnings: [] };
      markSeen(d.id);
      onRead(d.result as ReadResponse, img, 'new');
      setMissed(undefined);
      setLast('Loaded the reading that finished earlier. Check it against the photo below.');
    } catch {
      setError('Could not load that reading. Please read the photo again.');
    }
  };

  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setStatus('offline'));
  }, []);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy, done]);

  /** Pictures and PDFs → a list of page pictures, in the order chosen (PDF pages in page order). */
  const choose = async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    setError(undefined);
    setLast(undefined);
    const out: (PreparedImage & { name: string })[] = [];
    let pictures = 0;
    try {
      const audiveris = typeof status === 'object' && status.provider === 'audiveris';
      const maxEdge = audiveris ? MAX_EDGE_AUDIVERIS : undefined;
      const add = async (img: File) => {
        pictures++;
        // Audiveris reads a whole page at once and gains nothing from halves.
        const { pieces, longEdge } = await splitPicture(img, halves && !audiveris);
        for (const piece of pieces) out.push({ ...(await prepareImage(piece, longEdge, maxEdge)), name: piece.name });
      };
      for (const f of list) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          setPreparing(`Opening ${f.name}…`);
          const { pdfToImages } = await import('../vision/pdfPages');
          const imgs = await pdfToImages(f, (d, t) => setPreparing(`Turning ${f.name} into pictures: page ${d} of ${t}…`), maxEdge);
          for (const img of imgs) {
            setPreparing(`Preparing ${img.name}…`);
            await add(img);
          }
        } else {
          setPreparing(`Preparing ${f.name}…`);
          await add(f);
        }
      }
      if (out.length > pictures)
        setLast(
          `Cut ${pictures === 1 ? 'the picture' : `the ${pictures} pictures`} into ${out.length} parts between lines of music, so the reader sees every note bigger. They are read in order as one song.`,
        );
      setPages(out);
      setDone(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(undefined);
    }
  };

  useEffect(() => {
    if (incoming) choose(incoming.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  /** Read one page. Throws an Error whose `status` is the HTTP status. */
  const readOne = async (img: PreparedImage): Promise<ReadResponse> => {
    const res = await fetch('/api/read-score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: img.base64, mediaType: img.mediaType }),
    });
    const body = await res.json().catch(() => ({ error: 'The server did not answer properly.' }));
    if (!res.ok) throw Object.assign(new Error(body.error ?? `Error ${res.status}`), { status: res.status });
    return body as ReadResponse;
  };

  /** Wait (showing a countdown), e.g. for the free per-minute limit to reset. */
  const sleepUntil = (ms: number) =>
    new Promise<void>((resolve) => {
      setWaitUntil(Date.now() + ms);
      setTimeout(() => { setWaitUntil(undefined); resolve(); }, ms);
    });

  /**
   * Read pages[from…] in order. The first page starts a new song unless `appendFirst`;
   * every later page is added after the one before it.
   */
  const readAll = async (appendFirst: boolean, from = done) => {
    stopRef.current = false;
    setBusy(true);
    setError(undefined);
    let costSum = 0;
    let model = '';
    let i = from;
    try {
      while (i < pages.length) {
        if (stopRef.current) break;
        let res: ReadResponse | undefined;
        for (let attempt = 0; attempt < 4 && !res; attempt++) {
          try {
            res = await readOne(pages[i]);
          } catch (e) {
            const st = (e as { status?: number }).status;
            const msg = e instanceof Error ? e.message : String(e);
            // Per-minute free limit: wait a minute and carry on by itself.
            if (st === 429 && /minute/i.test(msg) && attempt < 3) {
              setLast(`Free reading limit for this minute reached after page ${i}. Waiting a minute, then carrying on…`);
              await sleepUntil(65_000);
              if (stopRef.current) break;
              continue;
            }
            // Google busy (503): wait two minutes and try again by itself, up to 3 times.
            if (st === 503 && attempt < 3) {
              setLast(`Google's servers are busy (page ${i + 1}). Waiting 2 minutes, then trying again by itself (try ${attempt + 2} of 4)… You can leave this page open.`);
              await sleepUntil(120_000);
              if (stopRef.current) break;
              continue;
            }
            throw e;
          }
        }
        if (!res) break;
        markSeen(res.readingId);
        onRead(res, pages[i], i === 0 && !appendFirst ? 'new' : 'append');
        costSum += res.usage.costUsd ?? 0;
        model = res.model;
        i++;
        setDone(i);
      }
      if (i >= pages.length) {
        const n = pages.length - from;
        const cost = costSum === 0 ? 'no charge' : `cost about $${costSum.toFixed(2)}`;
        setLast(`Read ${n} page${n === 1 ? '' : 's'} with ${model} (${cost}). Now check them against the photos below: uncertain notes are orange, problem bars are red.`);
        setPages([]);
        setDone(0);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Stopped at page ${i + 1} of ${pages.length}: ${msg}${i > 0 ? ` Pages 1–${i} are already in the app.` : ''} ${i > 0 ? `Press “Carry on from page ${i + 1}” to continue.` : `Press “Read all ${pages.length} pages” to try again.`}`);
    } finally {
      setBusy(false);
      setWaitUntil(undefined);
    }
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  const ready = status && status !== 'offline' && status.ready;
  const many = pages.length > 1;
  const current = pages[Math.min(done, pages.length - 1)];

  return (
    <section className="card photo" id="photo">
      <h2>Read a photo of a score</h2>

      {missed && !busy && (
        <p className="notice">
          A photo reading{missed.title ? ` of “${missed.title}”` : ''} finished at {new Date(missed.at).toLocaleTimeString()} but was not shown
          (the page reloaded while it was reading).{' '}
          <button className="primary" onClick={loadMissed}>Load it</button>{' '}
          <button className="link" onClick={() => { markSeen(missed.id); setMissed(undefined); }}>Not now</button>
        </p>
      )}
      {status === 'offline' && (
        <p className="warning-text">The photo-reading server is not running. Start the app with <code>npm run dev</code> (it starts both parts).</p>
      )}
      {status && status !== 'offline' && !status.ready && (
        <p className="warning-text">
          Photo reading needs an API key, which isn’t set up yet: a free Google Gemini key or an Anthropic Claude key. Copy{' '}
          <code>.env.example</code> to <code>.env</code>, paste your key, and restart <code>npm run dev</code>. See “Reading photos” in README.md.
        </p>
      )}

      <details className="tips" open={!pages.length}>
        <summary>How to take a good photo</summary>
        <ul>{PHOTO_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="muted small">
          Be aware: clear printed scores read well. Blurry photos, handwriting, pages photographed at an angle, and very crowded scores
          will not — expect mistakes there, and check every flagged note before you trust the playback.
        </p>
      </details>

      <div className="row">
        <button onClick={() => camera.current?.click()} disabled={busy}>📷 Take a photo</button>
        <button onClick={() => picker.current?.click()} disabled={busy}>🖼 Choose pictures or a PDF</button>
        <span className="muted small">You can pick several pages at once (in page order), a whole PDF, paste a picture (⌘V / Ctrl+V), or drag files onto the page.</span>
        <label className="small">
          <input
            type="checkbox"
            checked={halves}
            onChange={(e) => {
              setHalves(e.target.checked);
              try {
                localStorage.setItem(HALVES_KEY, e.target.checked ? 'yes' : 'no');
              } catch {
                /* private browsing: just not remembered */
              }
            }}
          />{' '}
          Cut each page in half for more detail (best for four-part music; each half counts as one reading)
        </label>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
        <input ref={picker} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf" hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
      </div>
      {preparing && <p className="position">{preparing}</p>}

      {many && (
        <div className="page-queue">
          <p className="small">
            <strong>{pages.length} pages</strong>, read in this order as one song{done > 0 ? ` — ${done} done` : ''}. Drag isn’t needed: pick the files in page order.
          </p>
          <ol className="page-thumbs">
            {pages.map((p, i) => (
              <li key={i} className={i < done ? 'done' : i === done && busy ? 'now' : undefined} title={p.name}>
                <img src={p.url} alt={`Page ${i + 1}`} />
                <span>{i + 1}{i < done ? ' ✓' : ''}{p.warnings.length ? ' ⚠️' : ''}</span>
              </li>
            ))}
          </ol>
          {pages.some((p) => p.warnings.length) && <p className="photo-warnings small">⚠️ Some pages may be hard to read: {pages.flatMap((p, i) => p.warnings.length ? [`page ${i + 1}`] : []).join(', ')}. Hover a page to see its name.</p>}
          <div className="row">
            {done === 0 ? (
              <>
                <button className="primary" onClick={() => readAll(false, 0)} disabled={busy || !ready}>Read all {pages.length} pages as one song</button>
                {canAppend && <button onClick={() => readAll(true, 0)} disabled={busy || !ready}>Add all after the current score</button>}
              </>
            ) : (
              <button className="primary" onClick={() => readAll(true, done)} disabled={busy || !ready}>Carry on from page {done + 1}</button>
            )}
            {busy ? (
              <button onClick={() => { stopRef.current = true; }}>Stop after this page</button>
            ) : (
              <button onClick={() => { setPages([]); setDone(0); }}>Cancel</button>
            )}
          </div>
          {busy && (
            <p className="position">
              {waitUntil
                ? `Waiting before trying again… ${Math.max(0, Math.ceil((waitUntil - now) / 1000))}s`
                : `Reading page ${done + 1} of ${pages.length}… ${seconds}s (each page usually takes 1–3 minutes)`}
            </p>
          )}
        </div>
      )}

      {!many && current && (
        <div className="photo-preview">
          <img src={current.url} alt="Photo to read" />
          <div>
            <p className="small muted">{current.width} × {current.height} pixels</p>
            {current.warnings.length ? (
              <ul className="photo-warnings">{current.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}</ul>
            ) : (
              <p className="ok small">✅ The photo looks clear.</p>
            )}
            <div className="row">
              <button className="primary" onClick={() => readAll(false, 0)} disabled={busy || !ready}>Read this page</button>
              {canAppend && <button onClick={() => readAll(true, 0)} disabled={busy || !ready}>Add as the next page</button>}
              <button onClick={() => setPages([])} disabled={busy}>Cancel</button>
            </div>
            {busy && <p className="position">{waitUntil ? `Waiting before trying again… ${Math.max(0, Math.ceil((waitUntil - now) / 1000))}s` : `Reading… ${seconds}s (usually 1–3 minutes — every note is checked carefully)`}</p>}
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {last && <p className="ok small">{last}</p>}
      {ready && typeof status === 'object' && (
        <p className="muted small">
          Reader: {status.provider === 'audiveris' ? 'Audiveris' : status.provider === 'gemini' ? `Google Gemini (${status.model})` : `Anthropic Claude (${status.model})`}.{' '}
          {status.provider === 'audiveris'
            ? status.note
            : status.provider === 'gemini'
              ? `${status.note} Each page counts as one reading of your free daily allowance.`
              : 'Each page costs a few cents to about a dollar, billed to your Anthropic API account.'}
        </p>
      )}
    </section>
  );
}
