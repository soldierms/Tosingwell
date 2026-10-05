// Reads a photo of a score with Google's Gemini API (has a free tier).
// Same prompt and same JSON shape as the Claude reader, so the rest of the app
// does not care which one was used.
//
// Free-tier note (Google's pricing page): content sent on the free tier is
// "used to improve our products". The app tells the user this.

import { SCORE_READING_SCHEMA, type ScoreReading } from '../shared/vision/schema';
import { ReadError, SYSTEM_PROMPT, type ReadResult } from './read';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

export async function readScoreGemini(imageBase64: string, mediaType: string, model = DEFAULT_GEMINI_MODEL): Promise<ReadResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ReadError('No Gemini API key is set up. Add GEMINI_API_KEY to the .env file.', 401);

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: 'Transcribe this page of music.' }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCORE_READING_SCHEMA,
      maxOutputTokens: 65536,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      thinkingConfig: { thinkingLevel: 'HIGH' },
    },
  };

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch {
    throw new ReadError('Could not reach the Gemini API. Check the internet connection.', 502);
  }
  const data = (await res.json().catch(() => ({}))) as GeminiResponse;

  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new ReadError('The Gemini API key was not accepted. Check GEMINI_API_KEY in the .env file.', 401);
    if (res.status === 401 || res.status === 403) throw new ReadError('The Gemini API key was not accepted. Check GEMINI_API_KEY in the .env file.', 401);
    if (res.status === 429) throw new ReadError('The free Gemini limit has been reached for now. Wait a minute (or until tomorrow for the daily limit) and try again.', 429);
    if (res.status === 404) throw new ReadError(`Gemini model "${model}" was not found. Set GEMINI_MODEL in .env to a current model.`, 400);
    if (res.status === 400) throw new ReadError(`Gemini rejected the request: ${msg}`, 400);
    throw new ReadError(`The Gemini API had a problem (${res.status}). Try again in a moment.`, 502);
  }

  if (data.promptFeedback?.blockReason) throw new ReadError(`Gemini declined to read this image (${data.promptFeedback.blockReason}). Try a clearer photo.`, 422);
  const cand = data.candidates?.[0];
  const reason = cand?.finishReason;
  if (reason === 'MAX_TOKENS') throw new ReadError('The page was too long to read in one go. Photograph half a page at a time.', 422);
  if (reason && reason !== 'STOP') throw new ReadError(`Gemini stopped early (${reason}). Try again or use a clearer photo.`, 422);
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');

  let reading: ScoreReading;
  try {
    reading = JSON.parse(text) as ScoreReading;
    if (!Array.isArray(reading.parts)) throw new Error('missing parts');
  } catch {
    throw new ReadError('The reading came back incomplete. Please try again.', 502);
  }

  const u = data.usageMetadata ?? {};
  return {
    reading,
    model: data.modelVersion ?? model,
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), costUsd: 0 },
  };
}
