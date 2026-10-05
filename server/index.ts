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
    res.json(result);
  } catch (e) {
    if (e instanceof ReadError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong while reading the photo.' });
  }
});

// Only reachable from this computer; the app (and your phone) reach it through the Vite dev server.
app.listen(PORT, '127.0.0.1', () => {
  const info = providerInfo();
  console.log(`Tosingwell server on http://127.0.0.1:${PORT} — ${info.provider} ${info.model}${info.ready ? '' : ' — NO API KEY SET (add it to .env)'}`);
});
