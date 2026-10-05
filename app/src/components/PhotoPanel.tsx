// "Read a photo": take or choose a picture of a score, check its quality,
// send it to the server (which asks Claude), and hand the reading to the app.

import { useEffect, useRef, useState } from 'react';
import type { ScoreReading } from '../../../shared/vision/schema';
import { prepareImage, PHOTO_TIPS, type PreparedImage } from '../vision/prepareImage';

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
}

export function PhotoPanel({ canAppend, onRead }: Props) {
  const [status, setStatus] = useState<{ ready: boolean; model: string; provider: 'gemini' | 'claude'; note?: string } | 'offline'>();
  const [image, setImage] = useState<PreparedImage>();
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const [last, setLast] = useState<string>();
  const [missed, setMissed] = useState<{ id: string; at: string; title: string | null }>();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

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
  }, [busy]);

  const choose = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(undefined);
    setLast(undefined);
    try {
      setImage(await prepareImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const read = async (mode: 'new' | 'append') => {
    if (!image) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch('/api/read-score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: image.base64, mediaType: image.mediaType }),
      });
      const body = await res.json().catch(() => ({ error: 'The server did not answer properly.' }));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      const data = body as ReadResponse;
      markSeen(data.readingId);
      onRead(data, image, mode);
      const cost = data.usage.costUsd === 0 ? ' — no charge' : data.usage.costUsd !== null ? ` — cost about $${data.usage.costUsd.toFixed(2)}` : '';
      const backup = typeof status === 'object' && data.model && !data.model.startsWith(status.model)
        ? ` The main model (${status.model}) was busy or out of free allowance, so a backup model read this page — it is less accurate; check it carefully.`
        : '';
      setLast(`Read with ${data.model}${cost}.${backup} Now check it against the photo below: uncertain notes are orange, problem bars are red.`);
      setImage(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = status && status !== 'offline' && status.ready;

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

      <details className="tips" open={!image}>
        <summary>How to take a good photo</summary>
        <ul>{PHOTO_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="muted small">
          Be aware: clear printed scores read well. Blurry photos, handwriting, pages photographed at an angle, and very crowded scores
          will not — expect mistakes there, and check every flagged note before you trust the playback.
        </p>
      </details>

      <div className="row">
        <button onClick={() => camera.current?.click()} disabled={busy}>📷 Take a photo</button>
        <button onClick={() => picker.current?.click()} disabled={busy}>🖼 Choose a picture</button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
        <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
      </div>

      {image && (
        <div className="photo-preview">
          <img src={image.url} alt="Photo to read" />
          <div>
            <p className="small muted">{image.width} × {image.height} pixels</p>
            {image.warnings.length ? (
              <ul className="photo-warnings">{image.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}</ul>
            ) : (
              <p className="ok small">✅ The photo looks clear.</p>
            )}
            <div className="row">
              <button className="primary" onClick={() => read('new')} disabled={busy || !ready}>Read this page</button>
              {canAppend && <button onClick={() => read('append')} disabled={busy || !ready}>Add as the next page</button>}
              <button onClick={() => setImage(undefined)} disabled={busy}>Cancel</button>
            </div>
            {busy && <p className="position">Reading… {seconds}s (usually 1–3 minutes — every note is checked carefully)</p>}
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {last && <p className="ok small">{last}</p>}
      {ready && typeof status === 'object' && (
        <p className="muted small">
          Reader: {status.provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'} ({status.model}).{' '}
          {status.provider === 'gemini' ? status.note : 'Each page costs a few cents to about a dollar, billed to your Anthropic API account.'}
        </p>
      )}
    </section>
  );
}
