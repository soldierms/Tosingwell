// The small Tosingwell server. Its only job: receive a photo from the app,
// send it to the AI reader (Google Gemini or Anthropic Claude, see provider.ts)
// with the secret API key, and return the reading.
// The key stays here (in .env), never in the browser or in git.

import express from 'express';
import { ReadError } from './read';
import { providerInfo, readWith } from './provider';

try {
  process.loadEnvFile('.env'); // GEMINI_API_KEY=… and/or ANTHROPIC_API_KEY=… (see .env.example)
} catch {
  // No .env file yet — the status endpoint will say so.
}

const PORT = Number(process.env.SERVER_PORT ?? 5190);
const MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const;
type Media = (typeof MEDIA)[number];

/**
 * The last finished reading, kept in memory so it is not lost if the page reloads (or the phone
 * locks) while a reading is running: the photo panel offers to load it. Cleared when the server stops.
 */
let lastReading: { id: string; at: string; title: string | null; image: string; mediaType: string; result: unknown } | undefined;

const app = express();
app.use(express.json({ limit: '25mb' }));

/** Is photo reading set up? (Never reveals the key itself.) */
app.get('/api/status', (_req, res) => {
  res.json(providerInfo());
});

app.post('/api/read-score', async (req, res) => {
  const { image, mediaType } = (req.body ?? {}) as { image?: unknown; mediaType?: unknown };
  if (typeof image !== 'string' || !image.length) return res.status(400).json({ error: 'No image was sent.' });
  if (typeof mediaType !== 'string' || !MEDIA.includes(mediaType as Media)) {
    return res.status(400).json({ error: 'Please send a JPEG, PNG or WebP image.' });
  }
  const bytes = Math.floor((image.length * 3) / 4);
  if (bytes > 10 * 1024 * 1024) return res.status(413).json({ error: 'The image is too large (over 10 MB).' });

  const started = Date.now();
  try {
    const result = await readWith(providerInfo(), image, mediaType as Media);
    console.log(`read-score: ${result.model}, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ` +
      `$${result.usage.costUsd?.toFixed(3) ?? '?'}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    lastReading = { id, at: new Date().toISOString(), title: result.reading.title, image, mediaType, result };
    res.json({ ...result, readingId: id });
  } catch (e) {
    if (e instanceof ReadError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong while reading the photo.' });
  }
});

/** Is there a finished reading the page may have missed? (Small answer: no photo, no notes.) */
app.get('/api/last-reading', (_req, res) => {
  if (!lastReading) return res.json({ available: false });
  res.json({ available: true, id: lastReading.id, at: lastReading.at, title: lastReading.title });
});

/** The full last reading, with its photo, to load into the app. */
app.get('/api/last-reading/full', (_req, res) => {
  if (!lastReading) return res.status(404).json({ error: 'No reading to load.' });
  res.json(lastReading);
});

// Only reachable from this computer; the app (and your phone) reach it through the Vite dev server.
app.listen(PORT, '127.0.0.1', () => {
  const info = providerInfo();
  console.log(`Tosingwell server on http://127.0.0.1:${PORT} — ${info.provider} ${info.model}${info.ready ? '' : ' — NO API KEY SET (add it to .env)'}`);
});
